/** KolCrawlerService — Crawl posts from tracked KOLs with Redis caching */
import { log } from "../utils/logger.js";
import { OUTPUT_FORMAT_INSTRUCTION } from "../prompts/outputFormat.js";
import { KolProfile, type IKolProfile } from "../db/models/KolProfile.js";
import { KolPost, type IKolPost, EKolPostStatus } from "../db/models/KolPost.js";
import { KolSettings, type ITierCrawlIntervals } from "../db/models/KolSettings.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";
import { settings } from "../config/settings.js";
import { getRedis } from "../db/redis.js";
import { KOL_TWEET_SCRIPT, KOL_TWEET_SCRIPT_BATCH, KOL_COMMENT_SCRIPT } from "../utils/kolCrawlScript.js";
import {
  parseBatchCrawlResult,
  type IRawPost,
} from "../utils/kolCrawlResultParser.js";
import { tierToPriority } from "../utils/taskPriority.js";

// Get Redis client
const redis = getRedis();
import type { Types } from "mongoose";

// ── Redis Cache Keys ───────────────────────────────────────────────────────────

const KOL_CRAWL_CACHE_PREFIX = "kol:crawl:";
const KOL_CRAWL_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
const MAX_CRAWL_WINDOW_MS = 6 * 60 * 60 * 1000; // 6h max crawl window

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
2. Run TWEET_SCRIPT via page.evaluate(TWEET_SCRIPT, "{{since}}"), passing the sinceTimestamp as second argument.
   - STOP scrolling immediately if any visible post has posted_at <= "{{since}}" — do not scroll further
   - Only process posts returned by the script (already filtered to newer than sinceTimestamp)
3. For each post where comments > 10 (max 5 posts):
   a. Navigate to post_url, wait 4s
   b. Run COMMENT_SCRIPT via page.evaluate(), add result as top_comments on that post
   c. Navigate back
4. Return JSON: {"posts": <posts array with top_comments populated>}

TWEET_SCRIPT (call as: page.evaluate(TWEET_SCRIPT, sinceTimestamp)):
\`\`\`
${KOL_TWEET_SCRIPT}
\`\`\`

COMMENT_SCRIPT:
\`\`\`
${KOL_COMMENT_SCRIPT}
\`\`\`
${OUTPUT_FORMAT_INSTRUCTION}`;

const BATCH_KOL_CRAWL_PROMPT_TEMPLATE = `For each handle below, sequentially:
1. Navigate to https://x.com/{handle}, wait 4s, scroll 2x (1s each)
2. Run TWEET_SCRIPT via page.evaluate(TWEET_SCRIPT, sinceTimestamp), passing the sinceTimestamp shown for that handle
   - STOP scrolling immediately if any visible post has posted_at <= sinceTimestamp — do not scroll further
   - Only process posts returned by the script (already filtered to newer than sinceTimestamp)
   - IMPORTANT: Do NOT include any post where posted_at <= sinceTimestamp in your JSON output
3. Wait 5s before next handle

Handles:
{{handleList}}

TWEET_SCRIPT (call as: page.evaluate(TWEET_SCRIPT, sinceTimestamp)):
\`\`\`
${KOL_TWEET_SCRIPT_BATCH}
\`\`\`

Return JSON: {"results": [{"handle": "...", "posts": [...]}]}
${OUTPUT_FORMAT_INSTRUCTION}`;

const COMMENT_CRAWL_PROMPT_TEMPLATE = `For each post below, sequentially:
1. Navigate to post_url, wait 3s
2. Run COMMENT_SCRIPT via page.evaluate(), collect comments array
3. Wait 2s before next post

Posts:
{{postList}}

COMMENT_SCRIPT:
\`\`\`
${KOL_COMMENT_SCRIPT}
\`\`\`

Return JSON with ALL posts and their comments:
{"results": [{"postId": "...", "post_url": "...", "comments": [{"content": "...", "author_handle": "...", "likes": 0, "reply_count": 0}]}]}
${OUTPUT_FORMAT_INSTRUCTION}`;

interface IKolCrawlInfo {
  handle: string;
  since: string; // ISO timestamp
  limit: number;
  tier?: string; // used to compute task priority
}

/**
 * Create a single batch task to crawl multiple KOLs.
 * Much more efficient than creating separate tasks for each KOL.
 */
async function createBatchCrawlTask(
  kols: IKolCrawlInfo[],
  priority: number,
  handleGroup: string | null,
): Promise<string> {
  const handleList = kols
    .map(k => `- @${k.handle} | sinceTimestamp: "${k.since}"`)
    .join("\n");

  const prompt = BATCH_KOL_CRAWL_PROMPT_TEMPLATE
    .replace(/\{\{handleList\}\}/g, handleList);

  const task = await Task.create({
    type: ETaskType.SINGLE_TASK_TRIGGER,
    agent: settings.openClawAgent,
    prompt: "pending",
    status: ETaskStatus.PENDING,
    priority,
    ...(handleGroup != null ? { handle_group: handleGroup } : {}),
    payload: {
      action: "batch_crawl",
      kolCount: kols.length,
      handles: kols.map(k => k.handle),
      sinceByHandle: Object.fromEntries(kols.map(k => [k.handle, k.since])),
      priority,
      handle_group: handleGroup,
    },
  });

  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  const command = `agent --agent ${settings.openClawAgent} --model ${settings.openClawCrawlModel} --thinking off --message '${escapedPrompt}'`;
  task.prompt = command;
  await task.save();

  log.info(`[KolCrawler] Created batch crawl task for ${kols.length} KOLs: ${task._id}`);
  return String(task._id);
}

/**
 * Create a Phase 2 task to crawl comments for posts that need it.
 * Triggered automatically after processBatchCrawlResult() saves posts.
 */
async function createCommentCrawlTask(
  posts: Array<{ id: string; post_url: string }>,
  priority: number,
  handleGroup: string | null,
): Promise<string> {
  const postList = posts
    .map(p => `- postId: ${p.id} | post_url: ${p.post_url}`)
    .join("\n");

  const prompt = COMMENT_CRAWL_PROMPT_TEMPLATE
    .replace(/\{\{postList\}\}/g, postList);

  const task = await Task.create({
    type: ETaskType.KOL_COMMENT_CRAWL,
    agent: settings.openClawAgent,
    prompt: "pending",
    status: ETaskStatus.PENDING,
    priority,
    ...(handleGroup != null ? { handle_group: handleGroup } : {}),
    payload: {
      action: "comment_crawl",
      postCount: posts.length,
      postIds: posts.map(p => p.id),
      priority,
      handle_group: handleGroup,
    },
  });

  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  const command = `agent --agent ${settings.openClawAgent} --model ${settings.openClawCrawlModel} --thinking off --message '${escapedPrompt}'`;
  task.prompt = command;
  await task.save();

  log.info(`[KolCrawler] Created comment crawl task for ${posts.length} posts: ${task._id}`);
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

  const task = await Task.create({
    type: ETaskType.CRON_JOB_TRIGGER,
    agent: settings.openClawAgent,
    prompt: "pending",
    status: ETaskStatus.PENDING,
  });

  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  const command = `agent --agent ${settings.openClawAgent} --model ${settings.openClawCrawlModel} --thinking off --message '${escapedPrompt}'`;
  task.prompt = command;
  await task.save();

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
): Promise<{ saved: number; skipped: number; posts: IKolPost[] }> {
  let saved = 0;
  let skipped = 0;
  const posts: IKolPost[] = [];

  for (const raw of rawPosts) {
    try {
      const existing = await KolPost.findOne({ post_url: raw.post_url });
      if (existing) {
        skipped++;
        continue;
      }

      const engagementScore = calculateEngagementScore(raw);
      // Posts with comments <= 10 don't need comment crawling
      const comments_crawled = (raw.comments ?? 0) <= 10;

      const post = await KolPost.create({
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
        is_retweet: raw.is_retweet ?? false,
        is_quote: raw.is_quote ?? false,
        ...(raw.quoted_post_url ? { quoted_post_url: raw.quoted_post_url } : {}),
        comments_crawled,
        top_comments: (raw.top_comments || []).map((c) => ({
          content: c.content,
          author_handle: c.author_handle,
          likes: c.likes,
          sentiment: "neutral",
          reply_count: c.reply_count || 0,
        })),
      });

      posts.push(post);
      saved++;
    } catch (error) {
      log.error(`[KolCrawler] Failed to save post: ${(error as Error).message}`);
      skipped++;
    }
  }

  return { saved, skipped, posts };
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
  sinceByHandle?: Record<string, string>,
  priority?: number,
  handleGroup?: string | null,
): Promise<ICrawlResult[]> {
  const batchResults = parseBatchCrawlResult(taskResult);
  const results: ICrawlResult[] = [];
  const allSavedPosts: IKolPost[] = [];

  for (const { handle, posts } of batchResults) {
    try {
      const kol = await KolProfile.findOne({ handle });
      if (!kol) {
        log.warn(`[KolCrawler] processBatchCrawlResult: handle "${handle}" not found in KolProfile`);
        continue;
      }

      // Server-side guard: drop posts older than the since timestamp used to prompt the agent
      const sinceISO = sinceByHandle?.[handle];
      const sinceDate = sinceISO ? new Date(sinceISO) : null;
      const freshPosts = sinceDate
        ? posts.filter(p => {
            const postedAt = new Date(p.posted_at);
            return !isNaN(postedAt.getTime()) && postedAt > sinceDate;
          })
        : posts;
      if (sinceDate && freshPosts.length < posts.length) {
        log.info(`[KolCrawler] @${handle}: dropped ${posts.length - freshPosts.length} stale posts (posted_at <= ${sinceISO})`);
      }

      // Keep only top 2 posts by engagement score per handle
      const MAX_POSTS_PER_HANDLE = 2;
      const topPosts = freshPosts.length > MAX_POSTS_PER_HANDLE
        ? [...freshPosts]
            .sort((a, b) => calculateEngagementScore(b) - calculateEngagementScore(a))
            .slice(0, MAX_POSTS_PER_HANDLE)
        : freshPosts;

      if (freshPosts.length > MAX_POSTS_PER_HANDLE) {
        log.info(`[KolCrawler] @${handle}: ${freshPosts.length} fresh posts, keeping top ${MAX_POSTS_PER_HANDLE} by engagement`);
      }

      const { saved, skipped, posts: savedPosts } = await processCrawlResults(kol._id, topPosts);
      allSavedPosts.push(...savedPosts);

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

  // Trigger Phase 2: comment crawl for posts with comments > 10
  const postsNeedingComments = allSavedPosts
    .filter(p => p.comments > 10)
    .slice(0, 15); // max 15 posts per batch (5 per handle × 3 handles)

  if (postsNeedingComments.length > 0) {
    try {
      await createCommentCrawlTask(
        postsNeedingComments.map(p => ({ id: String(p._id), post_url: p.post_url })),
        priority ?? 0,
        handleGroup ?? null,
      );
      log.info(`[KolCrawler] Queued comment crawl for ${postsNeedingComments.length} posts`);
    } catch (error) {
      log.error(`[KolCrawler] Failed to create comment crawl task: ${(error as Error).message}`);
    }
  }

  // Analysis is triggered by:
  // - PATCH /api/kol-posts/:id/comments (after Phase 2 comment crawl)
  // - kolDaemon.analyzePendingPosts() every 10 min (picks up posts with comments_crawled=true, status=NEW)

  const processedHandles = new Set(batchResults.map((r) => r.handle));
  for (const h of handles) {
    if (!processedHandles.has(h)) {
      log.warn(`[KolCrawler] Handle "${h}" was expected but missing from batch result`);
    }
  }

  return results;
}

// ── Comment Crawl Result Processor ───────────────────────────────────────────

interface IRawCommentResult {
  postId: string;
  post_url?: string;
  comments: Array<{
    content: string;
    author_handle: string;
    likes: number;
    reply_count?: number;
  }>;
}

/**
 * Process the result of a comment crawl task.
 * Updates each post's top_comments and sets comments_crawled = true.
 * Returns the number of posts updated.
 */
export async function processCommentCrawlResult(rawResult: string): Promise<number> {
  let parsed: { results?: IRawCommentResult[] };
  try {
    parsed = JSON.parse(rawResult);
  } catch {
    log.error("[KolCrawler] processCommentCrawlResult: failed to parse JSON");
    return 0;
  }

  const results = parsed?.results;
  if (!Array.isArray(results) || results.length === 0) {
    log.warn("[KolCrawler] processCommentCrawlResult: no results in payload");
    return 0;
  }

  let updated = 0;
  for (const item of results) {
    if (!item.postId) continue;
    try {
      const topComments = (item.comments || []).map((c) => ({
        content: c.content || "",
        author_handle: c.author_handle || "",
        likes: c.likes || 0,
        sentiment: "neutral" as const,
        reply_count: c.reply_count || 0,
      }));

      await KolPost.findByIdAndUpdate(item.postId, {
        top_comments: topComments,
        comments_crawled: true,
      });
      updated++;
      log.info(`[KolCrawler] Updated comments for post ${item.postId} (${topComments.length} comments)`);
    } catch (err: unknown) {
      log.error(`[KolCrawler] Failed to update post ${item.postId}: ${(err as Error).message}`);
    }
  }

  return updated;
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
  // Default: 6 hours ago
  return new Date(Date.now() - 6 * 60 * 60 * 1000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Parallel Crawl Export ─────────────────────────────────────────────────────

export interface ICrawlSpawnResult {
  tasksCreated: number;
  handles: string[];
}

/**
 * Spawn multiple batch crawl tasks (fire-and-forget).
 * Each task covers `crawl_handles_per_task` handles (default 2).
 * Handles per run = ceil(total_active / 6) to cover all KOLs every 24h (6 runs/day).
 * Results are processed asynchronously via POST /api/tasks/:id/process-result.
 */
export async function crawlAllKolsSequential(): Promise<ICrawlSpawnResult> {
  const kolSettings = await KolSettings.getSettings();
  const minTrustScore = kolSettings.safety.min_kol_trust_score;

  const totalKols = await KolProfile.countDocuments({
    is_active: true,
    reputation_score: { $gte: minTrustScore },
  });

  if (totalKols === 0) {
    log.info("[KolCrawler] No active KOLs to crawl");
    return { tasksCreated: 0, handles: [] };
  }

  // Cover all handles in 24h across 6 runs (every 4h)
  const RUNS_PER_DAY = 6;
  const handlesPerRun = Math.ceil(totalKols / RUNS_PER_DAY);

  // Round-robin: null last_crawled_at sorts first — new KOLs get priority
  const kols = await KolProfile.find({
    is_active: true,
    reputation_score: { $gte: minTrustScore },
  })
    .sort({ last_crawled_at: 1 })
    .limit(handlesPerRun);

  log.info(`[KolCrawler] Spawning tasks for ${kols.length}/${totalKols} KOLs (${handlesPerRun} per run)`);

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

  // Split into chunks and create one task per chunk (fire-and-forget)
  const chunkSize = kolSettings.crawl_handles_per_task;
  const allHandles: string[] = [];
  let tasksCreated = 0;

  for (let i = 0; i < kolInfos.length; i += chunkSize) {
    const chunk = kolInfos.slice(i, i + chunkSize);
    const handleGroup = chunk.length === 1 ? chunk[0].handle : null;
    await createBatchCrawlTask(chunk, 10, handleGroup);
    allHandles.push(...chunk.map((k) => k.handle));
    tasksCreated++;
  }

  log.info(`[KolCrawler] Spawned ${tasksCreated} tasks for handles: ${allHandles.join(", ")}`);
  return { tasksCreated, handles: allHandles };
}

/**
 * Crawl only KOLs whose per-tier interval has elapsed since last_crawled_at.
 * Called every 15 minutes by kolDaemon. Does NOT modify crawlAllKolsSequential.
 */
export async function crawlDueKols(): Promise<ICrawlSpawnResult> {
  const kolSettings = await KolSettings.getSettings();
  const intervals: ITierCrawlIntervals = kolSettings.tier_crawl_intervals ?? { S: 30, A: 120, B: 240, C: 480 };
  const minTrustScore = kolSettings.safety.min_kol_trust_score;

  const now = Date.now();
  const cutoffS = new Date(now - intervals.S * 60_000);
  const cutoffA = new Date(now - intervals.A * 60_000);
  const cutoffB = new Date(now - intervals.B * 60_000);
  const cutoffC = new Date(now - intervals.C * 60_000);

  const kols = await KolProfile.find({
    is_active: true,
    reputation_score: { $gte: minTrustScore },
    $or: [
      { tier: "S", $or: [{ last_crawled_at: null }, { last_crawled_at: { $lte: cutoffS } }] },
      { tier: "A", $or: [{ last_crawled_at: null }, { last_crawled_at: { $lte: cutoffA } }] },
      { tier: "B", $or: [{ last_crawled_at: null }, { last_crawled_at: { $lte: cutoffB } }] },
      { tier: "C", $or: [{ last_crawled_at: null }, { last_crawled_at: { $lte: cutoffC } }] },
    ],
  });

  if (kols.length === 0) {
    log.info("[KolCrawler] crawlDueKols — no KOLs due for crawl");
    return { tasksCreated: 0, handles: [] };
  }

  const tierOrder: Record<string, number> = { S: 0, A: 1, B: 2, C: 3 };
  kols.sort(
    (a, b) =>
      (tierOrder[a.tier] ?? 4) - (tierOrder[b.tier] ?? 4) ||
      (a.last_crawled_at?.getTime() ?? 0) - (b.last_crawled_at?.getTime() ?? 0),
  );

  log.info(`[KolCrawler] crawlDueKols — ${kols.length} KOLs due`);

  const kolInfos: IKolCrawlInfo[] = [];
  for (const kol of kols) {
    const cachedLastCrawled = await getCachedLastCrawled(kol.handle);
    const oldestAllowed = new Date(now - MAX_CRAWL_WINDOW_MS);
    const rawSince = cachedLastCrawled ?? kol.last_crawled_at ?? null;
    const since =
      rawSince && rawSince > oldestAllowed && rawSince <= new Date(now)
        ? rawSince
        : oldestAllowed;
    kolInfos.push({
      handle: kol.handle,
      since: since.toISOString(),
      limit: kolSettings.max_posts_per_crawl,
      tier: kol.tier,
    });
  }

  const chunkSize = kolSettings.crawl_handles_per_task;
  const allHandles: string[] = [];
  let tasksCreated = 0;

  for (let i = 0; i < kolInfos.length; i += chunkSize) {
    const chunk = kolInfos.slice(i, i + chunkSize);
    const chunkPriority = Math.max(...chunk.map(k => tierToPriority(k.tier ?? "C")));
    const handleGroup = chunk.length === 1 ? chunk[0].handle : null;
    await createBatchCrawlTask(chunk, chunkPriority, handleGroup);
    allHandles.push(...chunk.map((k) => k.handle));
    tasksCreated++;
  }

  log.info(`[KolCrawler] crawlDueKols — spawned ${tasksCreated} tasks for: ${allHandles.join(", ")}`);
  return { tasksCreated, handles: allHandles };
}

// ── Singleton Export ─────────────────────────────────────────────────────────

export const kolCrawlerService = new KolCrawlerService();
