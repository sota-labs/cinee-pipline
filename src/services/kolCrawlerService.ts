/** KolCrawlerService — Crawl posts from tracked KOLs with Redis caching */
import pLimit from "p-limit";
import { log } from "../utils/logger.js";
import { KolProfile, type IKolProfile } from "../db/models/KolProfile.js";
import {
  KolPost,
  type IKolPost,
  EKolPostStatus,
} from "../db/models/KolPost.js";
import {
  KolSettings,
} from "../db/models/KolSettings.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";
import { settings } from "../config/settings.js";
import { getRedis } from "../db/redis.js";
import {
  parseBatchCrawlResult,
  type IRawPost,
} from "../utils/kolCrawlResultParser.js";
import { buildTweetScript } from "../utils/kolCrawlScript.js";
import { OUTPUT_FORMAT_INSTRUCTION } from "../prompts/outputFormat.js";
import {
  getUserIdByHandle,
  getUserTweets,
  getTweetReplies,
  XRateLimitError,
  XUserNotFoundError,
} from "./platforms/x/xApiClient.js";
import { mapTweetToPost, mapRepliesToComments } from "./platforms/x/xResultMapper.js";

// Get Redis client
const redis = getRedis();
import type { Types } from "mongoose";

// ── Redis Cache Keys ───────────────────────────────────────────────────────────

const KOL_CRAWL_CACHE_PREFIX = "kol:crawl:";
const KOL_CRAWL_CACHE_TTL = 1 * 24 * 60 * 60; // 1 days in seconds
const MAX_CRAWL_WINDOW_MS = 2 * 60 * 60 * 1000; // 2h max crawl window

async function getCachedLastCrawled(handle: string): Promise<Date | null> {
  try {
    const cached = await redis.get(`${KOL_CRAWL_CACHE_PREFIX}${handle}`);
    if (cached) {
      return new Date(cached);
    }
  } catch (error) {
    log.warn(
      `[KolCrawler] Redis get failed for ${handle}: ${(error as Error).message}`,
    );
  }
  return null;
}

async function setCachedLastCrawled(
  handle: string,
  timestamp: Date,
): Promise<void> {
  try {
    await redis.setex(
      `${KOL_CRAWL_CACHE_PREFIX}${handle}`,
      KOL_CRAWL_CACHE_TTL,
      timestamp.toISOString(),
    );
  } catch (error) {
    log.warn(
      `[KolCrawler] Redis set failed for ${handle}: ${(error as Error).message}`,
    );
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
  dropped: number;
  errors: string[];
}

export interface IComment {
  content: string;
  author_handle: string;
  likes: number;
  reply_count: number;
}

// ── Crawl Result Processor ───────────────────────────────────────────────────

/**
 * Process crawl results from OpenClaw and save to database.
 * This is called after the task completes (via webhook or polling).
 */
export async function processCrawlResults(
  kolId: string | Types.ObjectId,
  rawPosts: IRawPost[],
): Promise<{
  saved: number;
  skipped: number;
  dropped: number;
  posts: IKolPost[];
}> {
  let saved = 0;
  let skipped = 0;
  let dropped = 0;
  const posts: IKolPost[] = [];

  for (const raw of rawPosts) {
    try {
      if (shouldDropAtCrawl(raw)) {
        dropped++;
        continue;
      }

      // Hard guard: reject posts older than MAX_CRAWL_WINDOW_MS regardless of agent output
      const postedAt = new Date(raw.posted_at);
      if (
        isNaN(postedAt.getTime()) ||
        postedAt < new Date(Date.now() - MAX_CRAWL_WINDOW_MS)
      ) {
        log.warn(
          `[KolCrawler] Dropping stale post ${raw.post_url} (posted_at: ${raw.posted_at})`,
        );
        dropped++;
        continue;
      }

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
        ...(raw.quoted_post_url
          ? { quoted_post_url: raw.quoted_post_url }
          : {}),
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
      log.error(
        `[KolCrawler] Failed to save post: ${(error as Error).message}`,
      );
      skipped++;
    }
  }

  return { saved, skipped, dropped, posts };
}

function shouldDropAtCrawl(raw: IRawPost): boolean {
  if (raw.is_retweet) return true;
  if (raw.content.trim().length < 15) return true;
  if (raw.is_quote && raw.content.trim().length < 30) return true;
  return false;
}

function calculateEngagementScore(post: IRawPost): number {
  // Simple engagement score formula
  // Weight: likes=1, comments=3, retweets=2, views=0.001
  const score =
    post.likes * 1 + post.comments * 3 + post.retweets * 2 + post.views * 0.001;
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
  _priority?: number,
  handleGroup?: string | null,
): Promise<ICrawlResult[]> {
  const batchResults = parseBatchCrawlResult(taskResult);
  const results: ICrawlResult[] = [];

  for (const { handle, posts } of batchResults) {
    try {
      const kol = await KolProfile.findOne({ handle });
      if (!kol) {
        log.warn(
          `[KolCrawler] processBatchCrawlResult: handle "${handle}" not found in KolProfile`,
        );
        continue;
      }

      // Server-side guard: drop posts older than the since timestamp used to prompt the agent
      const sinceISO = sinceByHandle?.[handle];
      const sinceDate = sinceISO ? new Date(sinceISO) : null;
      const freshPosts = sinceDate
        ? posts.filter((p) => {
            const postedAt = new Date(p.posted_at);
            return !isNaN(postedAt.getTime()) && postedAt > sinceDate;
          })
        : posts;
      if (sinceDate && freshPosts.length < posts.length) {
        log.info(
          `[KolCrawler] @${handle}: dropped ${posts.length - freshPosts.length} stale posts (posted_at <= ${sinceISO})`,
        );
      }

      const {
        saved,
        skipped,
        dropped,
        posts: savedPosts,
      } = await processCrawlResults(kol._id, freshPosts);

      const now = new Date();
      kol.last_crawled_at = now;
      await kol.save();
      await setCachedLastCrawled(kol.handle, now);

      results.push({
        kolId: kol._id,
        handle: kol.handle,
        postsFound: posts.length,
        postsSaved: saved,
        dropped,
        errors: [],
      });

      log.info(
        `[KolCrawler] @${handle}: ${posts.length} found, ${saved} saved, ${skipped} skipped, ${dropped} dropped at crawl`,
      );

      // Inline comment crawl via X API for posts with >10 comments
      const postsNeedingComments = savedPosts
        .filter((p) => p.comments > 10)
        .slice(0, 5);
      for (const post of postsNeedingComments) {
        try {
          const tweetId = post.post_url.split("/").pop();
          if (!tweetId) continue;
          const { tweets: replyTweets, includes: replyIncludes } = await getTweetReplies(tweetId);
          const comments = mapRepliesToComments(replyTweets, replyIncludes);
          await KolPost.findByIdAndUpdate(post._id, {
            top_comments: comments.map(c => ({ ...c, sentiment: "neutral" as const })),
            comments_crawled: true,
          });
          log.info(`[KolCrawler] Fetched ${comments.length} comments for post ${post._id} (@${handle})`);
        } catch (err) {
          log.warn(`[KolCrawler] Comment crawl failed for post ${post._id}: ${(err as Error).message}`);
        }
      }
    } catch (error) {
      log.error(
        `[KolCrawler] Failed processing @${handle}: ${(error as Error).message}`,
      );
      results.push({
        kolId: "",
        handle,
        postsFound: 0,
        postsSaved: 0,
        dropped: 0,
        errors: [(error as Error).message],
      });
    }
  }

  // Analysis is triggered by:
  // - PATCH /api/kol-posts/:id/comments (after Phase 2 comment crawl)
  // - kolDaemon.analyzePendingPosts() every 10 min (picks up posts with comments_crawled=true, status=NEW)

  const processedHandles = new Set(batchResults.map((r) => r.handle));
  for (const h of handles) {
    if (!processedHandles.has(h)) {
      log.warn(
        `[KolCrawler] Handle "${h}" was expected but missing from batch result`,
      );
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
export async function processCommentCrawlResult(
  rawResult: string,
): Promise<number> {
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
      log.info(
        `[KolCrawler] Updated comments for post ${item.postId} (${topComments.length} comments)`,
      );
    } catch (err: unknown) {
      log.error(
        `[KolCrawler] Failed to update post ${item.postId}: ${(err as Error).message}`,
      );
    }
  }

  return updated;
}

// ── Main Service ──────────────────────────────────────────────────────────────

export class KolCrawlerService {
  /**
   * Crawl a specific KOL via X API.
   */
  async crawlKol(
    kol: IKolProfile,
    options?: Partial<ICrawlOptions>,
  ): Promise<ICrawlResult> {
    // Determine since date — Redis cache → DB → default
    const cachedLastCrawled = await getCachedLastCrawled(kol.handle);
    const sinceDate =
      options?.since ??
      cachedLastCrawled ??
      kol.last_crawled_at ??
      getDefaultSinceDate();

    // Derive sinceId from most recent saved post for this KOL
    const latestPost = await KolPost.findOne({ kol_id: kol._id })
      .sort({ posted_at: -1 })
      .select("post_url")
      .lean();
    const sinceId = latestPost?.post_url
      ? latestPost.post_url.split("/").pop()
      : undefined;

    try {
      const userId = await getUserIdByHandle(kol.handle);
      const { tweets, includes } = await getUserTweets(userId, sinceId);

      // Filter by sinceDate as a secondary guard
      const freshTweets = tweets.filter(t => {
        if (!t.created_at) return true;
        return new Date(t.created_at) > sinceDate;
      });

      const rawPosts = freshTweets.map(t => mapTweetToPost(t, kol.handle, includes));

      const { saved, skipped, dropped, posts: savedPosts } = await processCrawlResults(kol._id, rawPosts);

      const now = new Date();
      kol.last_crawled_at = now;
      await kol.save();
      await setCachedLastCrawled(kol.handle, now);

      log.info(`[KolCrawler] @${kol.handle}: ${tweets.length} fetched, ${saved} saved, ${skipped} skipped, ${dropped} dropped`);

      // Inline comment crawl for posts with >10 comments
      const postsNeedingComments = savedPosts.filter(p => p.comments > 10).slice(0, 5);
      for (const post of postsNeedingComments) {
        try {
          const tweetId = post.post_url.split("/").pop();
          if (!tweetId) continue;
          const { tweets: replyTweets, includes: replyIncludes } = await getTweetReplies(tweetId);
          const comments = mapRepliesToComments(replyTweets, replyIncludes);
          await KolPost.findByIdAndUpdate(post._id, {
            top_comments: comments.map(c => ({ ...c, sentiment: "neutral" as const })),
            comments_crawled: true,
          });
        } catch (err) {
          log.warn(`[KolCrawler] Comment crawl failed for post ${post._id}: ${(err as Error).message}`);
        }
      }

      return {
        kolId: kol._id,
        handle: kol.handle,
        postsFound: tweets.length,
        postsSaved: saved,
        dropped,
        errors: [],
      };
    } catch (err) {
      if (err instanceof XRateLimitError) {
        log.warn(`[KolCrawler] Rate limit hit for @${kol.handle}, skipping cycle. Retry after ${err.retryAfter.toISOString()}`);
        return { kolId: kol._id, handle: kol.handle, postsFound: 0, postsSaved: 0, dropped: 0, errors: [err.message] };
      }
      if (err instanceof XUserNotFoundError) {
        log.warn(`[KolCrawler] @${kol.handle} not found on X, deactivating`);
        kol.is_active = false;
        await kol.save();
        return { kolId: kol._id, handle: kol.handle, postsFound: 0, postsSaved: 0, dropped: 0, errors: [err.message] };
      }
      throw err;
    }
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
  async getPendingCrawlTasks(): Promise<
    Array<{ taskId: string; handle: string; status: string }>
  > {
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
  return new Date(Date.now() - 2 * 60 * 60 * 1000);
}

// ── OpenClaw Batch Task Factory ──────────────────────────────────────────────

/** Build the OpenClaw agent prompt for a KOL batch crawl. */
function buildKolBatchCrawlPrompt(handle: string, sinceISO: string): string {
  const tweetScript = buildTweetScript(sinceISO);
  return `IMPORTANT: Do NOT write your own JavaScript. Use ONLY the exact script provided below.

1. Navigate (target=host) to https://x.com/${handle}, wait 4s.
2. Repeat up to 5 times:
   a. Call page.evaluate with the exact TWEET_SCRIPT string below (copy it verbatim, no modifications, no arguments).
      The script is a self-contained IIFE — call it as: page.evaluate(TWEET_SCRIPT)
      It returns an object: { posts: [...], shouldStop: boolean }
   b. Collect all items from result.posts.
   c. If result.shouldStop === true, STOP — do not scroll further.
   d. Otherwise scroll down (2s), then repeat.
3. Return JSON: {"handle": "${handle}", "posts": <collected posts array>}

TWEET_SCRIPT (copy verbatim into page.evaluate — do NOT pass any arguments):
\`\`\`
${tweetScript}
\`\`\`
${OUTPUT_FORMAT_INSTRUCTION}`;
}

export interface ICreateBatchTasksOptions {
  /** When true, ignore `last_crawled_at` and enqueue a task for every active KOL in the tiers. Default: false. */
  forceAll?: boolean;
  /** Per-tier cap to avoid quota blow-up. Default: 50. */
  maxPerTier?: number;
}

export interface ICreateBatchTasksResult {
  tasksCreated: number;
  handles: string[];
  skipped: string[];
}

/**
 * Query KOLs due for the given tiers and create one OpenClaw Task record per KOL.
 * The cinee-worker picks up each Task, runs the browser script, and POSTs results
 * back to /api/tasks/:id/complete. The webhook routes/tasks.ts:296-310 then calls
 * processBatchCrawlResult() — this function only generates the Tasks.
 */
export async function createBatchCrawlTasks(
  tiers: Array<"S" | "A" | "B" | "C">,
  options?: ICreateBatchTasksOptions,
): Promise<ICreateBatchTasksResult> {
  const forceAll = options?.forceAll ?? false;
  const maxPerTier = options?.maxPerTier ?? 50;
  const result: ICreateBatchTasksResult = { tasksCreated: 0, handles: [], skipped: [] };

  if (tiers.length === 0) return result;

  const kolSettings = await KolSettings.getSettings();
  const minTrustScore = kolSettings.safety.min_kol_trust_score;
  const now = Date.now();

  // Per-tier cutoff (minutes → ms). S uses 2h to match A off-prime cadence.
  const defaultSinceMs = (tier: "S" | "A" | "B" | "C"): number => {
    if (tier === "S") return 120 * 60_000;
    return (kolSettings.tier_batch_intervals[tier] ?? 120) * 60_000;
  };

  const kols = await KolProfile.find({
    is_active: true,
    reputation_score: { $gte: minTrustScore },
    tier: { $in: tiers },
    ...(forceAll
      ? {}
      : {
          $or: tiers.map((tier) => ({
            tier,
            $or: [
              { last_crawled_at: null },
              {
                last_crawled_at: {
                  $lte: new Date(now - defaultSinceMs(tier)),
                },
              },
            ],
          })),
        }),
  }).limit(tiers.length * maxPerTier);

  if (kols.length === 0) {
    log.info(`[KolCrawler] createBatchCrawlTasks — no KOLs due for tiers [${tiers.join(", ")}]`);
    return result;
  }

  log.info(
    `[KolCrawler] createBatchCrawlTasks — ${kols.length} KOLs to enqueue for tiers [${tiers.join(", ")}] (concurrency: ${kolSettings.crawl_concurrency})`,
  );

  const limit = pLimit(kolSettings.crawl_concurrency);

  await Promise.allSettled(
    kols.map((kol) =>
      limit(async () => {
        try {
          const since = kol.last_crawled_at ?? new Date(now - defaultSinceMs(kol.tier as "S" | "A" | "B" | "C"));
          const sinceISO = since.toISOString();
          const prompt = buildKolBatchCrawlPrompt(kol.handle, sinceISO);

          const escapedPrompt = prompt.replace(/'/g, "'\\''");
          const command = `agent --agent ${settings.openClawAgent} --message '${escapedPrompt}'`;

          await Task.create({
            type: ETaskType.SINGLE_TASK_TRIGGER,
            agent: settings.openClawAgent,
            prompt: command,
            status: ETaskStatus.PENDING,
            priority: 0,
            handle_group: kol.handle,
            payload: {
              action: "batch_crawl",
              handles: [kol.handle],
              sinceByHandle: { [kol.handle]: sinceISO },
              priority: 0,
              handle_group: kol.handle,
            },
          });

          result.handles.push(kol.handle);
          result.tasksCreated++;
        } catch (err) {
          result.skipped.push(kol.handle);
          log.error(
            `[KolCrawler] createBatchCrawlTasks — failed to enqueue @${kol.handle}: ${(err as Error).message}`,
          );
        }
      }),
    ),
  );

  log.info(
    `[KolCrawler] createBatchCrawlTasks — created ${result.tasksCreated} tasks, skipped ${result.skipped.length}: ${result.handles.join(", ")}`,
  );
  return result;
}

// ── Singleton Export ─────────────────────────────────────────────────────────

export const kolCrawlerService = new KolCrawlerService();
