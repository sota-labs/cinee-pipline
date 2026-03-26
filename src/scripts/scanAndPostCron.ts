/** Standalone Cron Script: db scan for scheduled posts to publish on X */
import mongoose from "mongoose";
import { execSync } from "child_process";
import { Post, EPostStatus } from "../db/models/Post.js";
import { connectDb } from "../db/connection.js";
import { log } from "../utils/logger.js";
import { settings } from "../config/settings.js";

// In-memory cursor to keep track of the last processed post across intervals
// We use this to avoid getting stuck on the same failing items if they remain 'scheduled'
let lastProcessedCursorId: string | null = null;

function runOpenClawPost(post: any): string | null {
  const prompt = `You are an AI Agent with browser access. Your job is to publish this specific content on X immediately.
  
Content to post:
${post.raw_content}

Steps:
1. Navigate to https://x.com/home.
2. Wait until web page load done
3. Type the following content into post area (where usually has placeholder text like "What's happening?"):
"""
${post.raw_content}
"""
4. Click the "Post" button (or the button with data-testid="tweetButtonInline").
5. Wait until the post is confirmed published
6. After the post is published, get the URL of the newly created post (e.g. https://x.com/<username>/status/<id>)
7. Report exactly in this format: POST_SUCCESS: <post_url>`;

  const escapedMessage = prompt.replace(/'/g, "'\\''");

  log.info(`Running OpenClaw to post ID: ${post._id}`);
  try {
    const output = execSync(
      `openclaw agent --agent ${settings.openClawAgent} --message '${escapedMessage}'`,
      {
        encoding: "utf-8",
        timeout: 300_000,
      },
    );
    const match = output.match(/POST_SUCCESS:\s*(https?:\/\/\S+)/);
    return match ? match[1] : "";
  } catch (error: any) {
    log.error(`OpenClaw error for post ${post._id}: ${error.message}`);
    return null;
  }
}

async function scanAndPost() {
  log.info(`Started DB scan for scheduled posts (limit 100)...`);
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
      log.info(
        `Processing post ID: ${post._id} (scheduled_at: ${post.scheduled_at})`,
      );

      const postUrl = runOpenClawPost(post);

      if (postUrl !== null) {
        post.status = EPostStatus.POSTED;
        if (postUrl) post.post_url = postUrl;
        await post.save();
        log.info(`Successfully posted ID: ${post._id}${postUrl ? ` → ${postUrl}` : ""}`);
      } else {
        post.status = EPostStatus.FAILED;
        await post.save();
        log.error(`Failed to post ID: ${post._id}`);
      }

      // Update in-memory cursor regardless of success/fail to keep moving forward
      lastProcessedCursorId = post._id.toString();
    }
  } catch (err) {
    log.error(`Error during DB scan: ${err}`);
  }
}

async function startDaemon() {
  await connectDb();

  // Scan once immediately
  await scanAndPost();

  // Run every 1.5 hours (90 minutes)
  const INTERVAL_MS = 90 * 60 * 1000;
  setInterval(async () => {
    await scanAndPost();
  }, INTERVAL_MS);

  log.info("Cron daemon initialized: DB scan will run every 1.5 hours.");
}

startDaemon().catch((err) => {
  log.error(`Daemon fatal error: ${err}`);
  process.exit(1);
});
