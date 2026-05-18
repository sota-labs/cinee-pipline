/** KolCrawlerService — Crawl posts from tracked KOLs with Redis caching */
import { log } from "../utils/logger.js";
import { OUTPUT_FORMAT_INSTRUCTION } from "../prompts/outputFormat.js";
import { KolProfile, type IKolProfile } from "../db/models/KolProfile.js";
import { KolPost, type IKolPost, EKolPostStatus } from "../db/models/KolPost.js";
import { KolSettings } from "../db/models/KolSettings.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";
import { settings } from "../config/settings.js";
import { getRedis } from "../db/redis.js";
import { KOL_TWEET_SCRIPT, KOL_TWEET_SCRIPT_BATCH, KOL_COMMENT_SCRIPT } from "../utils/kolCrawlScript.js";
import {
  parseBatchCrawlResult,
  type IRawPost,
} from "../utils/kolCrawlResultParser.js";

// Get Redis client
const redis = getRedis();
import type { Types } from "mongoose";

// ── Redis Cache Keys ───────────────────────────────────────────────────────────

const KOL_CRAWL_CACHE_PREFIX = "kol:crawl:";
const KOL_CRAWL_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
const MAX_CRAWL_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h max crawl window

async function getCachedLastCrawled(handle: string): Promise<Date | null> {
  try {
    const cached = await redis.get(`${KOL_CRAWL_CACHE_PREFIX}${handle}`);
    if (cached) {
      return new Date(cached);
    }
  } catch (error) {
    log.warn(`[KolCrawler] Redis get failed for ${handle}: ${(error as Error).message}`);
  }
  return null;
}

async function setCachedLastCrawled(handle: string, timestamp: Date): Promise<void> {
  try {
    await redis.setex(
      `${KOL_CRAWL_CACHE_PREFIX}${handle}`,
      KOL_CRAWL_CACHE_TTL,
      timestamp.toISOString()
    );
  } catch (error) {
    log.warn(`[KolCrawler] Redis set failed for ${handle}: ${(error as Error).message}`);
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ICrawlOptions {
  since?: Date;
  limit?: number;
  kolId?: string;
}

export interface ICrawlResult {
  kolId: string | Types.ObjectId;
  handle: string;
  postsFound: number;
  postsSaved: number;
  errors: string[];
}

export interface IComment {
  content: string;
  author_handle: string;
  likes: number;
  reply_count: number;
}

// ── OpenClaw Integration ─────────────────────────────────────────────────────

const KOL_CRAWL_PROMPT_TEMPLATE = `1. Navigate to https://x.com/{{handle}}, wait 8s, scroll 3x (2s each).
2. Run TWEET_SCRIPT via page.evaluate(), collect posts array.
3. For each post where comments > 10 (max 5 posts):
   a. Navigate to post_url, wait 4s
   b. Run COMMENT_SCRIPT via page.evaluate(), add result as top_comments on that post
   c. Navigate back
4. Return JSON: {"posts": <posts array with top_comments populated>}

TWEET_SCRIPT:
\`\`\`
${KOL_TWEET_SCRIPT}
\`\`\`

COMMENT_SCRIPT:
\`\`\`
${KOL_COMMENT_SCRIPT}
\`\`\`
${OUTPUT_FORMAT_INSTRUCTION}`;

const BATCH_KOL_CRAWL_PROMPT_TEMPLATE = `For each handle below, sequentially:
1. Navigate to https://x.com/{handle}, wait 8s, scroll 3x (2s each)
2. Run TWEET_SCRIPT via page.evaluate(TWEET_SCRIPT, sinceTimestamp), passing the sinceTimestamp shown for that handle — posts older than sinceTimestamp will be filtered out by the script
3. For each post where comments > 10 (max 5 posts per KOL):
   a. Navigate to post_url, wait 4s
   b. Run COMMENT_SCRIPT via page.evaluate(), add as top_comments
   c. Navigate back to profile
4. Wait 10s before next handle

Handles:
{{handleList}}

TWEET_SCRIPT (call as: page.evaluate(TWEET_SCRIPT, sinceTimestamp)):
\`\`\`
${KOL_TWEET_SCRIPT_BATCH}
\`\`\`

COMMENT_SCRIPT:
\`\`\`
${KOL_COMMENT_SCRIPT}
\`\`\`

Return JSON: {"results": [{"handle": "...", "posts": [...]}]}
${OUTPUT_FORMAT_INSTRUCTION}`;

interface IKolCrawlInfo {
  handle: string;
  since: string; // ISO timestamp
  limit: number;
}

/**
 * Create a single batch task to crawl multiple KOLs.
 * Much more efficient than creating separate tasks for each KOL.
 */
async function createBatchCrawlTask(
  kols: IKolCrawlInfo[],
): Promise<string> {
  const handleList = kols
    .map(k => `- @${k.handle} | sinceTimestamp: "${k.since}"`)
    .join("\n");

  const prompt = BATCH_KOL_CRAWL_PROMPT_TEMPLATE
    .replace(/\{\{handleList\}\}/g, handleList);

  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  const command = `agent --agent ${settings.openClawAgent} --message '${escapedPrompt}'`;

  const task = await Task.create({
    type: ETaskType.SINGLE_TASK_TRIGGER,
    agent: settings.openClawAgent,
    prompt: command,
    status: ETaskStatus.PENDING,
    payload: { 
      action: "batch_crawl",
      kolCount: kols.length,
      handles: kols.map(k => k.handle),
    },
  });

  log.info(`[KolCrawler] Created batch crawl task for ${kols.length} KOLs: ${task._id}`);
  return String(task._id);
}

/**
 * Create a Task record for OpenClaw to execute crawling (single KOL - legacy).
 * The actual browser automation runs in isolated session.
 */
async function createCrawlTask(
  handle: string,
  since: Date,
  limit: number,
): Promise<string> {
  const sinceISO = since.toISOString();
  const prompt = KOL_CRAWL_PROMPT_TEMPLATE
    .replace(/\{\{handle\}\}/g, handle)
    .replace(/\{\{since\}\}/g, sinceISO)
    .replace(/\{\{limit\}\}/g, String(limit));

  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  const command = `agent --agent ${settings.openClawAgent} --message '${escapedPrompt}'`;

  const task = await Task.create({
    type: ETaskType.CRON_JOB_TRIGGER,
    agent: settings.openClawAgent,
    prompt: command,
    status: ETaskStatus.PENDING,
  });

  log.info(`[KolCrawler] Queued crawl task for @${handle}: ${task._id}`);
  return String(task._id);
}

// ── Crawl Result Processor ───────────────────────────────────────────────────

/**
 * Process crawl results from OpenClaw and save to database.
 * This is called after the task completes (via webhook or polling).
 */
export async function processCrawlResults(
  kolId: string | Types.ObjectId,
  rawPosts: IRawPost[],
): Promise<{ saved: number; skipped: number }> {
  let saved = 0;
  let skipped = 0;

  for (const raw of rawPosts) {
    try {
      // Check if post already exists
      const existing = await KolPost.findOne({ post_url: raw.post_url });
      if (existing) {
        skipped++;
        continue;
      }

      // Calculate engagement score
      const engagementScore = calculateEngagementScore(raw);

      // Create new post
      await KolPost.create({
        kol_id: kolId,
        platform: "twitter",
        post_url: raw.post_url,
        content: raw.content,
        media_urls: raw.media_urls || [],
        posted_at: new Date(raw.posted_at),
        likes: raw.likes,
        comments: raw.comments,
        retweets: raw.retweets,
        views: raw.views,
        engagement_score: engagementScore,
        status: EKolPostStatus.NEW,
        top_comments: (raw.top_comments || []).map((c) => ({
          content: c.content,
          author_handle: c.author_handle,
          likes: c.likes,
          sentiment: "neutral", // Will be analyzed later
          reply_count: c.reply_count || 0,
        })),
      });

      saved++;
    } catch (error) {
      log.error(`[KolCrawler] Failed to save post: ${(error as Error).message}`);
      skipped++;
    }
  }

  return { saved, skipped };
}

function calculateEngagementScore(post: IRawPost): number {
  // Simple engagement score formula
  // Weight: likes=1, comments=3, retweets=2, views=0.001
  const score =
    post.likes * 1 +
    post.comments * 3 +
    post.retweets * 2 +
    post.views * 0.001;
  return Math.round(score);
}

/**
 * Process a completed batch crawl task result.
 * Parses JSON, looks up KolProfiles, saves posts per handle.
 * Called by POST /api/tasks/:id/process-result endpoint.
 */
export async function processBatchCrawlResult(
  taskResult: string,
  handles: string[],
): Promise<ICrawlResult[]> {
  const batchResults = parseBatchCrawlResult(taskResult);
  const results: ICrawlResult[] = [];

  for (const { handle, posts } of batchResults) {
    try {
      const kol = await KolProfile.findOne({ handle });
      if (!kol) {
        log.warn(`[KolCrawler] processBatchCrawlResult: handle "${handle}" not found in KolProfile`);
        continue;
      }

      const { saved, skipped } = await processCrawlResults(kol._id, posts);

      const now = new Date();
      kol.last_crawled_at = now;
      await kol.save();
      await setCachedLastCrawled(kol.handle, now);

      results.push({
        kolId: kol._id,
        handle: kol.handle,
        postsFound: posts.length,
        postsSaved: saved,
        errors: [],
      });

      log.info(`[KolCrawler] @${handle}: ${posts.length} found, ${saved} saved, ${skipped} skipped`);
    } catch (error) {
      log.error(`[KolCrawler] Failed processing @${handle}: ${(error as Error).message}`);
      results.push({
        kolId: "",
        handle,
        postsFound: 0,
        postsSaved: 0,
        errors: [(error as Error).message],
      });
    }
  }

  const processedHandles = new Set(batchResults.map((r) => r.handle));
  for (const h of handles) {
    if (!processedHandles.has(h)) {
      log.warn(`[KolCrawler] Handle "${h}" was expected but missing from batch result`);
    }
  }

  return results;
}

// ── Main Service ──────────────────────────────────────────────────────────────

export class KolCrawlerService {
  /**
   * Crawl all active KOLs.
   * Creates tasks for OpenClaw to execute.
   */
  async crawlAllKols(): Promise<ICrawlResult[]> {
    const settings = await KolSettings.getSettings();
    const minTrustScore = settings.safety.min_kol_trust_score;

    // Get all active KOLs with good reputation
    const kols = await KolProfile.find({
      is_active: true,
      reputation_score: { $gte: minTrustScore },
    });

    log.info(`[KolCrawler] Starting crawl for ${kols.length} KOLs`);

    const results: ICrawlResult[] = [];

    for (const kol of kols) {
      try {
        const result = await this.crawlKol(kol, {
          limit: settings.max_posts_per_crawl,
        });
        results.push(result);

        // Rate limiting: 5 second delay between KOLs
        await delay(5000);
      } catch (error) {
        log.error(`[KolCrawler] Failed to crawl @${kol.handle}: ${(error as Error).message}`);
        results.push({
          kolId: kol._id,
          handle: kol.handle,
          postsFound: 0,
          postsSaved: 0,
          errors: [(error as Error).message],
        });
      }
    }

    return results;
  }

  /**
   * Crawl a specific KOL.
   */
  async crawlKol(
    kol: IKolProfile,
    options?: Partial<ICrawlOptions>,
  ): Promise<ICrawlResult> {
    const settings = await KolSettings.getSettings();
    const limit = options?.limit ?? settings.max_posts_per_crawl;

    // Determine since date - use Redis cache first, fallback to DB
    const cachedLastCrawled = await getCachedLastCrawled(kol.handle);
    const since = options?.since ?? cachedLastCrawled ?? kol.last_crawled_at ?? getDefaultSinceDate();

    // Queue crawl task via OpenClaw
    const taskId = await createCrawlTask(kol.handle, since, limit);

    // Update last_crawled_at in both DB and Redis
    const now = new Date();
    kol.last_crawled_at = now;
    await kol.save();
    await setCachedLastCrawled(kol.handle, now);

    log.info(`[KolCrawler] Queued crawl for @${kol.handle} (task: ${taskId})`);

    return {
      kolId: kol._id,
      handle: kol.handle,
      postsFound: 0, // Will be updated when task completes
      postsSaved: 0,
      errors: [],
    };
  }

  /**
   * Detect new posts for a KOL (local DB query).
   */
  async detectNewPosts(kolId: string): Promise<IKolPost[]> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    return KolPost.find({
      kol_id: kolId,
      crawled_at: { $gte: twentyFourHoursAgo },
      status: EKolPostStatus.NEW,
    }).sort({ posted_at: -1 });
  }

  /**
   * Get pending crawl tasks status.
   */
  async getPendingCrawlTasks(): Promise<Array<{ taskId: string; handle: string; status: string }>> {
    const tasks = await Task.find({
      type: ETaskType.CRON_JOB_TRIGGER,
      agent: "openclaw",
      status: { $in: [ETaskStatus.PENDING, ETaskStatus.PROCESSING] },
    }).lean();

    return tasks.map((t) => {
      const handleMatch = t.prompt.match(/x\.com\/([\w_]+)/);
      return {
        taskId: String(t._id),
        handle: handleMatch?.[1] ?? "unknown",
        status: t.status,
      };
    });
  }

  /**
   * Update KOL stats based on crawled posts.
   */
  async updateKolStats(kolId: string): Promise<void> {
    const kol = await KolProfile.findById(kolId);
    if (!kol) return;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const posts = await KolPost.find({
      kol_id: kolId,
      posted_at: { $gte: thirtyDaysAgo },
    });

    if (posts.length === 0) return;

    // Calculate averages
    const totalLikes = posts.reduce((sum, p) => sum + p.likes, 0);
    const totalComments = posts.reduce((sum, p) => sum + p.comments, 0);
    const totalRetweets = posts.reduce((sum, p) => sum + p.retweets, 0);

    kol.avg_likes_per_post = Math.round(totalLikes / posts.length);
    kol.avg_comments_per_post = Math.round(totalComments / posts.length);
    kol.avg_retweets_per_post = Math.round(totalRetweets / posts.length);
    kol.post_frequency = parseFloat((posts.length / 30).toFixed(2));

    await kol.save();
    log.info(`[KolCrawler] Updated stats for @${kol.handle}`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDefaultSinceDate(): Date {
  // Default: 24 hours ago
  return new Date(Date.now() - 24 * 60 * 60 * 1000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for OpenClaw task to complete by polling
 */
async function waitForTaskCompletion(
  taskId: string,
  maxWaitMs: number = 300000, // 5 minutes max
  pollIntervalMs: number = 5000, // Check every 5 seconds
): Promise<{ success: boolean; result?: string; error?: string }> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const task = await Task.findById(taskId);

    if (!task) {
      return { success: false, error: "Task not found" };
    }

    if (task.status === ETaskStatus.COMPLETED) {
      return { success: true, result: task.result };
    }

    if (task.status === ETaskStatus.FAILED) {
      return { success: false, error: task.result || "Task failed" };
    }

    // Still pending or processing, wait and poll again
    await delay(pollIntervalMs);
  }

  return { success: false, error: "Task timeout" };
}

// ── Sequential Crawl Export (for rate limiting) ──────────────────────────────

export interface ISequentialCrawlOptions {
  delayBetweenKolsMs?: number; // Default: 10000 (10s)
  maxWaitPerKolMs?: number;    // Default: 300000 (5 min)
}

/**
 * Crawl all KOLs using a SINGLE batch task.
 * OpenClaw will crawl sequentially to avoid rate limits.
 * Much more efficient than creating 200 separate tasks.
 */
export async function crawlAllKolsSequential(
  options: ISequentialCrawlOptions = {},
): Promise<ICrawlResult[]> {
  const kolSettings = await KolSettings.getSettings();
  const minTrustScore = kolSettings.safety.min_kol_trust_score;

  const kols = await KolProfile.find({
    is_active: true,
    reputation_score: { $gte: minTrustScore },
  });

  if (kols.length === 0) {
    log.info("[KolCrawler] No active KOLs to crawl");
    return [];
  }

  log.info(`[KolCrawler] Starting batch crawl for ${kols.length} KOLs in SINGLE task`);

  // Build KOL info list with their last crawled times
  const kolInfos: IKolCrawlInfo[] = [];
  for (const kol of kols) {
    const cachedLastCrawled = await getCachedLastCrawled(kol.handle);
    const now = new Date();
    const oldestAllowed = new Date(now.getTime() - MAX_CRAWL_WINDOW_MS);
    const rawSince = cachedLastCrawled ?? kol.last_crawled_at ?? null;
    const since = rawSince && rawSince > oldestAllowed && rawSince <= now ? rawSince : oldestAllowed;
    kolInfos.push({
      handle: kol.handle,
      since: since.toISOString(),
      limit: kolSettings.max_posts_per_crawl,
    });
  }

  // Create SINGLE batch task for all KOLs
  const taskId = await createBatchCrawlTask(kolInfos);
  const maxWait = options.maxWaitPerKolMs ?? 600000; // 10 min default per KOL, so 200 KOLs = ~33 min max

  log.info(`[KolCrawler] Waiting for batch task ${taskId} to complete...`);

  // Wait for completion (poll every 10s)
  const taskResult = await waitForTaskCompletion(taskId, maxWait * kols.length, 10000);

  if (!taskResult.success) {
    log.error(`[KolCrawler] Batch task failed: ${taskResult.error}`);
    // Return empty results for all KOLs
    return kols.map(kol => ({
      kolId: kol._id,
      handle: kol.handle,
      postsFound: 0,
      postsSaved: 0,
      errors: [taskResult.error || "Batch task failed"],
    }));
  }

  // Process batch results
  const results: ICrawlResult[] = [];

  if (taskResult.result) {
    try {
      const handles = kols.map((k) => k.handle);
      const processed = await processBatchCrawlResult(taskResult.result, handles);
      results.push(...processed);
    } catch (error) {
      log.error(`[KolCrawler] Failed to process batch results: ${(error as Error).message}`);
    }
  }

  log.info(`[KolCrawler] Batch crawl completed: ${results.length}/${kols.length} KOLs processed`);
  return results;
}

// ── Singleton Export ─────────────────────────────────────────────────────────

export const kolCrawlerService = new KolCrawlerService();
