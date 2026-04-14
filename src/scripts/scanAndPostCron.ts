/** Standalone Cron Script: scan DB for scheduled posts and create post tasks. */
import mongoose from "mongoose";
import { Post, EPostStatus, Task, ETaskType } from "../db/index.js";
import { connectDb } from "../db/connection.js";
import { log } from "../utils/logger.js";
import { settings } from "../config/settings.js";

let lastProcessedCursorId: string | null = null;

function buildPostNowPrompt(rawContent: string, xUser: string): string {
  const firstWords = rawContent.trim().split(/\s+/).slice(0, 8).join(" ");
  return `You are an AI Agent with browser access. Your job is to publish this specific content on X immediately.

BROWSER RULE: Keep ONLY ONE tab open at all times. Close any extra tabs before starting.

STEP 1 — COMPOSE & POST:
1. Close all extra tabs. Navigate to https://x.com/home in the single tab.
2. Wait until the page fully loads (tweet compose area is visible).
3. Type the following content into the post area exactly:
"""
${rawContent}
"""
4. Click the "Post" button ([data-testid="tweetButtonInline"]).
5. Wait 5 seconds. If an error banner appears, report POST_FAILED: error banner shown and stop.

STEP 2 — VERIFY:
6. In the SAME tab, navigate to https://x.com/${xUser}
7. Wait until the profile page fully loads and the first tweet article is visible.
8. Click on the FIRST <article> to open its detail page — do NOT open in new tab.
9. Wait until the post detail page fully loads.
10. Verify:
    CHECK A: The post text must START WITH or CONTAIN: "${firstWords}"
    CHECK B: The <time> element must show a timestamp within the last 3 minutes.
11. If BOTH checks pass — report: POST_SUCCESS_VERIFIED: <current_browser_url>
12. If EITHER check fails — report: POST_FAILED: <reason>`;
}

async function scanAndCreateTasks() {
  log.info("Started DB scan for scheduled posts...");
  try {
    const cursorId = lastProcessedCursorId;

    const query: Record<string, any> = {
      status: EPostStatus.SCHEDULED,
      scheduled_at: { $lte: new Date() },
    };

    if (cursorId) {
      query._id = { $gt: new mongoose.Types.ObjectId(cursorId) };
    }

    const posts = await Post.find(query)
      .sort({ scheduled_at: 1, _id: 1 })
      .limit(100);

    log.info(`Found ${posts.length} posts ready to publish.`);

    for (const post of posts) {
      log.info(`Creating task for post ${post._id} (scheduled_at: ${post.scheduled_at})`);

      // Skip if a pending/processing task already exists for this post
      const existing = await Task.findOne({
        ref_id: post._id.toString(),
        type: ETaskType.SCAN_AND_POST,
        status: { $in: ["pending", "processing"] },
      });

      if (existing) {
        log.info(`Task already exists (${existing._id}) for post ${post._id} — skipping`);
        lastProcessedCursorId = post._id.toString();
        continue;
      }

      const prompt = buildPostNowPrompt(post.raw_content, settings.xUsername);

      const task = await Task.create({
        type: ETaskType.SCAN_AND_POST,
        agent: settings.openClawAgent,
        prompt,
        ref_id: post._id.toString(),
        ref_collection: "posts",
        payload: {
          post_id: post._id.toString(),
          raw_content: post.raw_content,
          scheduled_at: post.scheduled_at,
        },
      });

      log.info(`Task created: ${task._id} (scan_and_post) for post ${post._id}`);
      lastProcessedCursorId = post._id.toString();
    }
  } catch (err) {
    log.error(`Error during DB scan: ${err}`);
  }
}

async function startDaemon() {
  await connectDb();

  await scanAndCreateTasks();

  const INTERVAL_MS = 90 * 60 * 1000;
  setInterval(async () => {
    await scanAndCreateTasks();
  }, INTERVAL_MS);

  log.info("Scan daemon initialized: will check for scheduled posts every 1.5 hours.");
}

startDaemon().catch((err) => {
  log.error(`Daemon fatal error: ${err}`);
  process.exit(1);
});
