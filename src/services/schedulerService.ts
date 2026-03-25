/** Scheduler service — OpenClaw isolated cron job management. */
import { execSync } from "child_process";
import { log } from "../utils/logger.js";
import * as dotenv from "dotenv";
import { settings } from "../config/settings.js";
dotenv.config();

const API = process.env.PUBLIC_API_URL || "http://localhost:3000";

interface CronJob {
  name: string;
  schedule: string;
  message: string;
  description: string;
}

// ── Prompt definitions ───────────────────────────────────────────────────────

const SCRAPE_PROMPT = `Open https://x.com/notifications in the browser. 
Find all notification items that are comments or replies from the last 24 hours. 
Scroll the notifications page as needed to ensure no items from the last 24 hours are missed.

For each notification found:
1. Extract the 'reply_content' (text) and 'url'.
2. Evaluate the content of the comment:
   - If the comment is meaningful, constructive, or part of a genuine discussion, set status = "resolved".
   - If the comment is spam, a bot-like promotion, irrelevant gibberish, or just "trash" content, set status = "rejected".
3. Prepare a JSON object for each reply with:
   - reply_content: (the comment text)
   - tone_used: "supportive"
   - status: (either "resolved" or "rejected" based on your evaluation)
   - platform: "x"
   - url: (the full URL of the comment)
   - created_at: (current ISO timestamp)
   - updated_at: (current ISO timestamp)

After processing all items, send a single POST request to ${API}/api/tools/db/replies with the final array of these objects.`;

const REPLY_PROMPT = `Step 1: Call GET ${API}/api/tools/db/replies to fetch the list of replies. 
Step 2: For each reply in the response that has status "draft" or "resolved": 
  a) Open the reply "url" field in the browser. 
  b) Read the "reply_content". Compose a new response in the tone of a CEO (professional, visionary, and decisive).
     - MANDATORY: The response must be strictly UNDER 300 characters.
     - Keep it concise, high-impact, and relevant to the original content.
     - Avoid fluff or generic "bot" phrases.
     - Post this CEO-style response on X. 
  c) Wait 5 seconds before processing the next reply. 
  d) After successfully replying, call PATCH ${API}/api/tools/db/replies 
     with JSON body: { "_id": "<the reply _id>", "status": "replied" }. 
Process all matching replies sequentially with 5-second gaps. Do not skip any.`;

const RESEARCH_AND_DRAFT_PROMPT = `You are an AI Agent with browser access acting as a visionary tech CEO who deeply understands cinema and AI filmmaking.

Step 1: Research & Selection
- Open the browser and go to https://x.com/search.
- Search for the following keywords one by one: "Sora", "Runway Gen-3", "Kling AI", "AI Filmmaking".
- Filter results to posts from the last 24 hours with the highest engagement (likes, reposts, replies).
- Select the single most outstanding post that contains a video or image. Save its URL and key content.

Step 2: Content Creation (CEO Persona)
- Write a post (under 300 characters) from the perspective of a tech CEO who understands cinema deeply.
- Tone: Strategic, focused on how AI is transforming the production pipeline (e.g. "Sora isn't just video — it's a redefinition of Pre-visualization").
- The post MUST include the source link from Step 1 as a reference.
- Do NOT directly promote any product. Be insightful, not salesy.

Step 3: Save as Draft for Review
- Send a POST request to ${API}/api/content-review/drafts with this JSON body:
  {
    "platform": "twitter",
    "content_type": "hot_take",
    "raw_content": "<the exact content you created in Step 2>",
    "ai_stack": ["<AI tools mentioned, e.g. Sora, Runway Gen-3, Kling>"],
    "research_source": "<the source URL from Step 1>",
    "research_summary": "<brief summary of what the source post was about>",
    "status": "pending_review"
    "media": ["<{
      "type": "<the media type: video, image, or gif>",
      "url": "<the media URL>",
      "thumbnail": "<the media thumbnail URL if the media is a video, otherwise empty>",
      "duration": "<the media duration if the media is a video, otherwise empty>"
    }>"],
    "video_details": <the video details if the post is a video, otherwise empty>,
    "is_viral_candidate": <true if the post is a viral candidate, false otherwise>,
    "external_refs": "<the source URL from Step 1>",
    "metadata": {},
  }
- Report the API response to confirm the draft was created successfully.
- Do NOT post to X directly. The content will be reviewed via Telegram before posting.`;

const POST_APPROVED_CONTENT_PROMPT = `You are an AI Agent with browser access. Your job is to publish approved content on X.

Step 1: Fetch Approved Content
- Call GET ${API}/api/content-review/drafts?status=approved,scheduled to get drafts ready to post.
- If no drafts are found, report "No approved drafts to post" and stop.
- For scheduled drafts, only post if the scheduled_at time has passed.

Step 2: Post Each Approved Draft
For each approved/scheduled draft:
  a) Navigate to https://x.com/home.
  b) Wait until web page load done
  c) Wait for the compose text area to appear.
  d) Type the draft's "raw_content" into post area (where usually has placeholder text like "What's happening?").
  e) Click the "Post" button (or the button with data-testid="tweetButtonInline").
  f) After posting, call PATCH ${API}/api/content-review/drafts/<draft_id> with:
     { "status": "posted" }
  g) Wait 10 seconds before processing the next draft.

Step 3: Report
- Report how many drafts were posted and any errors encountered.`;

// ── Job definitions ─────────────────────────────────────────────────────────

const CRON_JOBS: CronJob[] = [
  {
    name: "scrape_x_notifications",
    schedule: "0 * * * *",
    message: SCRAPE_PROMPT,
    description: "Scrape X notifications and store replies (every hour at :00)",
  },
  {
    name: "reply_x_notifications",
    schedule: "30 * * * *",
    message: REPLY_PROMPT,
    description: "Auto-reply on X and update status (every hour at :30)",
  },
  {
    name: "research_and_draft_morning",
    schedule: "0 9 * * *",
    message: RESEARCH_AND_DRAFT_PROMPT,
    description:
      "Research AI filmmaking trends and create draft for review (9 AM daily)",
  },
  {
    name: "research_and_draft_evening",
    schedule: "0 17 * * *",
    message: RESEARCH_AND_DRAFT_PROMPT,
    description:
      "Research AI filmmaking trends and create draft for review (5 PM daily)",
  },
  {
    name: "post_approved_content",
    schedule: "*/15 * * * *",
    message: POST_APPROVED_CONTENT_PROMPT,
    description: "Check and post approved/scheduled drafts (every 15 minutes)",
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function runOpenClaw(args: string): string {
  try {
    return execSync(`openclaw ${args}`, {
      encoding: "utf-8",
      timeout: 30_000,
    }).trim();
  } catch (error: any) {
    log.error(`OpenClaw error: ${error.message}`);
    throw error;
  }
}

function buildAddCommand(job: CronJob): string {
  const escapedMessage = job.message.replace(/'/g, "'\\''");
  return `cron add --name "${job.name}" --cron "${job.schedule}" --tz "Asia/Ho_Chi_Minh" --session isolated --message '${escapedMessage}' --no-deliver --description "${job.description}"`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function registerIsolatedJobs(): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];

  for (const job of CRON_JOBS) {
    try {
      const cmd = buildAddCommand(job);
      const output = runOpenClaw(cmd);
      log.info(`Registered: ${job.name} (${job.schedule})`);
      results.push({ name: job.name, status: "registered", output });
    } catch (error: any) {
      log.error(`Failed to register: ${job.name}`);
      results.push({ name: job.name, status: "failed", error: error.message });
    }
  }

  return results;
}

export function listJobs(): string {
  try {
    return runOpenClaw("cron list");
  } catch {
    return "Failed to list jobs";
  }
}

export function removeAllJobs(): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];

  for (const job of CRON_JOBS) {
    try {
      const output = runOpenClaw(`cron rm ${job.name}`);
      results.push({ name: job.name, status: "removed", output });
    } catch (error: any) {
      results.push({ name: job.name, status: "failed", error: error.message });
    }
  }

  return results;
}

export function registerSingleJob(jobName: string): Record<string, unknown> {
  const job = CRON_JOBS.find((j) => j.name === jobName);
  if (!job) {
    return {
      name: jobName,
      status: "not_found",
      error: `Job "${jobName}" not found in definitions`,
    };
  }
  try {
    const cmd = buildAddCommand(job);
    const output = runOpenClaw(cmd);
    log.info(`Registered: ${job.name} (${job.schedule})`);
    return { name: job.name, status: "registered", output };
  } catch (error: any) {
    log.error(`Failed to register: ${job.name}`);
    return { name: job.name, status: "failed", error: error.message };
  }
}

export function removeSingleJob(jobName: string): Record<string, unknown> {
  const job = CRON_JOBS.find((j) => j.name === jobName);
  if (!job) {
    return {
      name: jobName,
      status: "not_found",
      error: `Job "${jobName}" not found in definitions`,
    };
  }
  try {
    const output = runOpenClaw(`cron rm ${job.name}`);
    return { name: job.name, status: "removed", output };
  } catch (error: any) {
    return { name: job.name, status: "failed", error: error.message };
  }
}

export function checkGateway(): boolean {
  try {
    runOpenClaw("health");
    return true;
  } catch {
    return false;
  }
}

export function getJobDefinitions(): CronJob[] {
  return CRON_JOBS;
}
