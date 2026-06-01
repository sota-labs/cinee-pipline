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
  type ITierCrawlIntervals,
} from "../db/models/KolSettings.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";
import { getRedis } from "../db/redis.js";
import {
  parseBatchCrawlResult,
  type IRawPost,
} from "../utils/kolCrawlResultParser.js";
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
   * Crawl all active KOLs in parallel (concurrency controlled by KolSettings.crawl_concurrency).
   */
  async crawlAllKols(): Promise<ICrawlResult[]> {
    const settings = await KolSettings.getSettings();
    const minTrustScore = settings.safety.min_kol_trust_score;

    const kols = await KolProfile.find({
      is_active: true,
      reputation_score: { $gte: minTrustScore },
    });

    log.info(`[KolCrawler] Starting crawl for ${kols.length} KOLs (concurrency: ${settings.crawl_concurrency})`);

    const limit = pLimit(settings.crawl_concurrency);

    const results = await Promise.all(
      kols.map((kol) =>
        limit(async () => {
          try {
            return await this.crawlKol(kol, { limit: settings.max_posts_per_crawl });
          } catch (error) {
            log.error(`[KolCrawler] Failed to crawl @${kol.handle}: ${(error as Error).message}`);
            return {
              kolId: kol._id,
              handle: kol.handle,
              postsFound: 0,
              postsSaved: 0,
              dropped: 0,
              errors: [(error as Error).message],
            } as ICrawlResult;
          }
        }),
      ),
    );

    return results;
  }

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

// ── Parallel Crawl Export ─────────────────────────────────────────────────────

export interface ICrawlSpawnResult {
  tasksCreated: number;
  handles: string[];
}

/**
 * Crawl a round-robin slice of active KOLs in parallel.
 * Covers all handles in 24h across 6 runs (every 4h).
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

  const RUNS_PER_DAY = 6;
  const handlesPerRun = Math.ceil(totalKols / RUNS_PER_DAY);

  const kols = await KolProfile.find({
    is_active: true,
    reputation_score: { $gte: minTrustScore },
  })
    .sort({ last_crawled_at: 1 })
    .limit(handlesPerRun);

  log.info(`[KolCrawler] Crawling ${kols.length}/${totalKols} KOLs (concurrency: ${kolSettings.crawl_concurrency})`);

  const limit = pLimit(kolSettings.crawl_concurrency);
  const allHandles: string[] = [];

  const results = await Promise.allSettled(
    kols.map((kol) =>
      limit(async () => {
        await kolCrawlerService.crawlKol(kol, { limit: kolSettings.max_posts_per_crawl });
        return kol.handle;
      }),
    ),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      allHandles.push(result.value);
    } else {
      log.error(`[KolCrawler] Crawl failed: ${result.reason}`);
    }
  }

  log.info(`[KolCrawler] Crawled ${allHandles.length} KOLs: ${allHandles.join(", ")}`);
  return { tasksCreated: allHandles.length, handles: allHandles };
}

/**
 * Crawl only KOLs whose per-tier interval has elapsed since last_crawled_at.
 * Called every 15 minutes by kolDaemon.
 */
export async function crawlDueKols(): Promise<ICrawlSpawnResult> {
  const kolSettings = await KolSettings.getSettings();
  const intervals: ITierCrawlIntervals = kolSettings.tier_crawl_intervals ?? {
    S: 30,
    A: 120,
    B: 240,
    C: 480,
  };
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

  log.info(`[KolCrawler] crawlDueKols — ${kols.length} KOLs due (concurrency: ${kolSettings.crawl_concurrency})`);

  const limit = pLimit(kolSettings.crawl_concurrency);
  const allHandles: string[] = [];
  let rateLimitHit = false;

  const results = await Promise.allSettled(
    kols.map((kol) =>
      limit(async () => {
        if (rateLimitHit) return null;
        await kolCrawlerService.crawlKol(kol, { limit: kolSettings.max_posts_per_crawl });
        return kol.handle;
      }),
    ),
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      allHandles.push(result.value);
    } else if (result.status === "rejected") {
      if (result.reason instanceof XRateLimitError) {
        log.warn("[KolCrawler] Rate limit hit during crawlDueKols, stopping batch");
        rateLimitHit = true;
      } else {
        log.error(`[KolCrawler] Crawl failed: ${result.reason}`);
      }
    }
  }

  log.info(`[KolCrawler] crawlDueKols — crawled ${allHandles.length}: ${allHandles.join(", ")}`);
  return { tasksCreated: allHandles.length, handles: allHandles };
}

// ── Singleton Export ─────────────────────────────────────────────────────────

export const kolCrawlerService = new KolCrawlerService();
