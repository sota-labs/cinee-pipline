/** KolCrawlerService — Crawl posts from tracked KOLs */
import { log } from "../utils/logger.js";
import { KolProfile, type IKolProfile } from "../db/models/KolProfile.js";
import { KolPost, type IKolPost, EKolPostStatus } from "../db/models/KolPost.js";
import { KolReputationCache } from "../db/models/KolReputationCache.js";
import { KolSettings } from "../db/models/KolSettings.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";
import type { Types } from "mongoose";

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

const KOL_CRAWL_PROMPT_TEMPLATE = `You are KolCrawler. Your task:
1. Navigate to https://x.com/{{handle}}
2. Collect recent posts since {{since}}
3. For each post, extract:
   - post_url (full URL)
   - content (text content)
   - posted_at (ISO timestamp)
   - likes, comments, retweets, views (numbers)
   - media_urls (array of image/video URLs if any)
4. For posts with > 10 comments, collect top 10 most-liked comments:
   - content (comment text)
   - author_handle (without @)
   - likes (number)
   - reply_count (number)

Return JSON format:
{
  "posts": [
    {
      "post_url": "...",
      "content": "...",
      "posted_at": "2026-01-01T00:00:00Z",
      "likes": 100,
      "comments": 50,
      "retweets": 20,
      "views": 1000,
      "media_urls": [],
      "top_comments": [
        {"content": "...", "author_handle": "...", "likes": 10, "reply_count": 2}
      ]
    }
  ]
}

Constraints:
- Max {{limit}} posts
- Skip posts older than 24 hours
- Respect rate limits: 5 second delay between actions`;

/**
 * Create a Task record for OpenClaw to execute crawling.
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
  const command = `message --session isolated --content '${escapedPrompt}' --no-deliver`;

  const task = await Task.create({
    type: ETaskType.CRON_JOB_TRIGGER,
    agent: "openclaw",
    prompt: command,
    status: ETaskStatus.PENDING,
  });

  log.info(`[KolCrawler] Queued crawl task for @${handle}: ${task._id}`);
  return String(task._id);
}

// ── Crawl Result Processor ───────────────────────────────────────────────────

interface IRawPost {
  post_url: string;
  content: string;
  posted_at: string;
  likes: number;
  comments: number;
  retweets: number;
  views: number;
  media_urls?: string[];
  top_comments?: Array<{
    content: string;
    author_handle: string;
    likes: number;
    reply_count: number;
  }>;
}

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

    // Determine since date
    const since = options?.since ?? kol.last_crawled_at ?? getDefaultSinceDate();

    // Queue crawl task via OpenClaw
    const taskId = await createCrawlTask(kol.handle, since, limit);

    // Update last_crawled_at (we update optimistically, will be refined when task completes)
    kol.last_crawled_at = new Date();
    await kol.save();

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

// ── Singleton Export ─────────────────────────────────────────────────────────

export const kolCrawlerService = new KolCrawlerService();
