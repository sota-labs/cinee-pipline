/** OwnAccountCrawlerService — Crawl and seed own account posts for AI learning */
import { log } from "../utils/logger.js";
import { OUTPUT_FORMAT_INSTRUCTION } from "../prompts/outputFormat.js";
import { Post, EPostStatus } from "../db/models/Post.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";
import { settings } from "../config/settings.js";
import { KOL_TWEET_SCRIPT_BATCH } from "../utils/kolCrawlScript.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IOwnAccountCrawlOptions {
  /** How many days back to crawl. Default: 30 */
  daysBack?: number;
  /** Max posts to seed. Default: 100 */
  limit?: number;
}

export interface IOwnAccountCrawlResult {
  handle: string;
  postsFound: number;
  postsSaved: number;
  postsSkipped: number;
  errors: string[];
}

interface IRawOwnPost {
  post_url: string;
  content: string;
  posted_at: string;
  likes: number;
  comments: number;
  retweets: number;
  views: number;
  media_urls?: string[];
}

// ── Prompt Template ────────────────────────────────────────────────────────────

const OWN_ACCOUNT_CRAWL_PROMPT = `Crawl own account posts for AI learning:
1. Navigate to https://x.com/{{handle}}, wait 4s, scroll 5x (2s each) to load more posts
2. Run TWEET_SCRIPT via page.evaluate(TWEET_SCRIPT, sinceTimestamp) with sinceTimestamp: "{{since}}"
3. Return JSON: {"handle": "{{handle}}", "posts": <posts array>}

TWEET_SCRIPT (call as: page.evaluate(TWEET_SCRIPT, sinceTimestamp)):
\`\`\`
${KOL_TWEET_SCRIPT_BATCH}
\`\`\`
${OUTPUT_FORMAT_INSTRUCTION}`;

// ── Service ────────────────────────────────────────────────────────────────────

class OwnAccountCrawlerService {
  /**
   * Queue a crawl task for the own account.
   * Returns the task ID — cinee-worker will execute it and call back with results.
   */
  async queueCrawlTask(
    options: IOwnAccountCrawlOptions = {},
  ): Promise<string | null> {
    const handle = settings.xUsername;
    if (!handle) {
      log.error("[OwnAccountCrawler] X_USERNAME not configured");
      return null;
    }

    const daysBack = options.daysBack ?? 30;
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    const prompt = OWN_ACCOUNT_CRAWL_PROMPT.replace(
      /\{\{handle\}\}/g,
      handle,
    ).replace(/\{\{since\}\}/g, since.toISOString());

    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const command = `agent --agent ${settings.openClawAgent} --message '${escapedPrompt}'`;

    const task = await Task.create({
      type: ETaskType.SINGLE_TASK_TRIGGER,
      agent: settings.openClawAgent,
      prompt: command,
      status: ETaskStatus.PENDING,
      payload: {
        action: "own_account_crawl",
        handle,
        daysBack,
        limit: options.limit ?? 100,
      },
    });

    log.info(
      `[OwnAccountCrawler] Queued crawl task for @${handle}: ${task._id}`,
    );
    return String(task._id);
  }

  /**
   * Process raw crawl results and seed into Post collection.
   * Called after the OpenClaw task completes.
   */
  async processCrawlResult(
    rawResult: string,
    limit = 100,
  ): Promise<IOwnAccountCrawlResult> {
    const handle = settings.xUsername || "own_account";
    const result: IOwnAccountCrawlResult = {
      handle,
      postsFound: 0,
      postsSaved: 0,
      postsSkipped: 0,
      errors: [],
    };

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawResult);
    } catch {
      result.errors.push("Failed to parse crawl result JSON");
      log.error("[OwnAccountCrawler] Failed to parse crawl result");
      return result;
    }

    const data = parsed as Record<string, unknown>;
    const posts = Array.isArray(data.posts)
      ? (data.posts as IRawOwnPost[])
      : [];

    result.postsFound = posts.length;
    log.info(
      `[OwnAccountCrawler] Processing ${posts.length} posts from @${handle}`,
    );

    const toProcess = posts.slice(0, limit);

    for (const raw of toProcess) {
      try {
        if (!raw.content || !raw.post_url) {
          result.postsSkipped++;
          continue;
        }

        // Skip if already seeded (deduplicate by post_url)
        const existing = await Post.findOne({ post_url: raw.post_url });
        if (existing) {
          result.postsSkipped++;
          continue;
        }

        await Post.create({
          platform: "twitter",
          content_type: "engagement",
          raw_content: raw.content,
          status: EPostStatus.POSTED,
          post_url: raw.post_url,
          media: (raw.media_urls ?? []).map((url) => ({
            type: "image" as const,
            url,
          })),
          ai_stack: [],
          is_viral_candidate: false,
          external_refs: [],
          edit_history: [],
          // Use posted_at from crawl data if available
          ...(raw.posted_at ? { created_at: new Date(raw.posted_at) } : {}),
        });

        result.postsSaved++;
      } catch (error) {
        const msg = (error as Error).message;
        result.errors.push(`Failed to save post: ${msg}`);
        log.error(`[OwnAccountCrawler] Failed to save post: ${msg}`);
        result.postsSkipped++;
      }
    }

    log.info(
      `[OwnAccountCrawler] Done: ${result.postsSaved} saved, ${result.postsSkipped} skipped`,
    );
    return result;
  }

  /** Count seeded own-account posts available for learning */
  async countSeedPosts(): Promise<number> {
    return Post.countDocuments({
      platform: "twitter",
      status: EPostStatus.POSTED,
    });
  }
}

export const ownAccountCrawlerService = new OwnAccountCrawlerService();
