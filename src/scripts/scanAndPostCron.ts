/** Standalone Cron Script: db scan for approved drafts to post on X */
import mongoose from "mongoose";
import { execSync } from "child_process";
import { ContentDraft, EDraftStatus } from "../db/models/ContentDraft.js";
import { connectDb } from "../db/connection.js";
import { log } from "../utils/logger.js";
import { Post } from "../db/models/Post.js";

// In-memory cursor to keep track of the last processed draft across intervals
// We use this to avoid getting stuck on the same failing items if they remain 'approved'
let lastProcessedCursorId: string | null = null;

function runOpenClawPost(draft: any): boolean {
  const prompt = `You are an AI Agent with browser access. Your job is to publish this specific content on X immediately.
  
Content to post:
${draft.raw_content}

Steps:
1. Navigate to https://x.com/compose/post.
2. Wait for the compose text area to appear.
3. Type the exact content above into the text area.
4. Click the "Post" button (or the button with data-testid="tweetButtonInline").
5. If a login prompt appears, STOP and report it.
6. After successfully posting, finish and report success.`;

  const escapedMessage = prompt.replace(/'/g, "'\\''");
  
  log.info(`Running OpenClaw to post draft ID: ${draft._id}`);
  try {
    execSync(`openclaw agent --agent isolated --message '${escapedMessage}'`, {
      encoding: "utf-8",
      stdio: "inherit",
      timeout: 120_000,
    });
    return true;
  } catch (error: any) {
    log.error(`OpenClaw error for draft ${draft._id}: ${error.message}`);
    return false;
  }
}

async function scanAndPost() {
  log.info(`Started DB scan for scheduled drafts (limit 100)...`);
  try {
    const cursorId = lastProcessedCursorId;
    
    const query: Record<string, any> = {
      status: EDraftStatus.SCHEDULED,
      scheduled_at: { $gte: new Date() },
    };

    if (cursorId) {
      query._id = { $gt: new mongoose.Types.ObjectId(cursorId) };
    }

    const drafts = await ContentDraft.find(query)
      .sort({ _id: 1 })
      .limit(100);

    log.info(`Found ${drafts.length} drafts matching the criteria.`);

    for (const draft of drafts) {
      log.info(`Processing draft ID: ${draft._id}`);

      // Mark as processing before starting prolonged task
      draft.status = EDraftStatus.PROCESSING;
      await draft.save();
      if (draft.post_id) {
        await Post.updateOne({ _id: draft.post_id }, { status: "processing" });
        log.info(`Updated existing Post (ID: ${draft.post_id}) to 'processing'`);
      }

      // Attempt to post on X using openclaw (blocks until done)
      const success = runOpenClawPost(draft);

      if (success) {
        // Record draft as posted
        draft.status = EDraftStatus.POSTED;
        await draft.save();

        // Update the existing Post document if it is linked
        if (draft.post_id) {
          await Post.updateOne({ _id: draft.post_id }, { status: "posted" });
          log.info(`Updated existing Post (ID: ${draft.post_id}) to 'posted'`);
        }
        
        log.info(`Successfully processed and posted draft ID: ${draft._id}`);
      } else {
        // Mark as failed if the OpenClaw script aborted early or threw an error
        draft.status = EDraftStatus.FAILED;
        await draft.save();
        if (draft.post_id) {
          await Post.updateOne({ _id: draft.post_id }, { status: "failed" });
        }
        log.error(`Failed to post draft ID: ${draft._id}`);
      }

      // Update in-memory cursor regardless of success/fail to keep moving forward
      lastProcessedCursorId = draft._id.toString();
    }

  } catch (err) {
    log.error(`Error during DB scan: ${err}`);
  }
}

async function startDaemon() {
  await connectDb();
  
  // Scan once immediately
  await scanAndPost();

  // Run every 1 hour (3.6 million milliseconds)
  const INTERVAL_MS = 10 * 1000;
  setInterval(async () => {
    await scanAndPost();
  }, INTERVAL_MS);

  log.info("Cron daemon initialized: DB scan will run every 1 hour.");
}

startDaemon().catch((err) => {
  log.error(`Daemon fatal error: ${err}`);
  process.exit(1);
});
