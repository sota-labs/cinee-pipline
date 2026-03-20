/** Scheduler service — OpenClaw isolated cron job management. */
import { execSync } from "child_process";
import { log } from "../utils/logger.js";

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

const RESEARCH_AND_POST_PROMPT = `You are an AI Agent with browser access acting as a visionary tech CEO who deeply understands cinema and AI filmmaking.

Step 1: Research & Selection
- Open the browser and go to https://x.com/search.
- Search for the following keywords one by one: "Sora", "Runway Gen-3", "Kling AI", "AI Filmmaking".
- Filter results to posts from the last 24 hours with the highest engagement (likes, reposts, replies).
- Select the single most outstanding post that contains a video or image. Save its URL and key content.

Step 2: Content Creation (CEO Persona)
- Write a post (under 300 words) from the perspective of a tech CEO who understands cinema deeply.
- Tone: Strategic, focused on how AI is transforming the production pipeline (e.g. "Sora isn't just video — it's a redefinition of Pre-visualization").
- The post MUST include the source link from Step 1 as a reference.
- Do NOT directly promote any product. Be insightful, not salesy.

Step 3: Publish on X
- Navigate to https://x.com/compose/post.
- Wait for the compose text area to appear.
- Type the full content you created in Step 2 into the text area.
- Click the "Post" button (or the button with data-testid="tweetButtonInline").
- If a login prompt appears, STOP and report it.

Step 4: Save to Database
- After posting successfully, send a POST request to ${API}/api/tools/db/posts with this JSON body:
  {
    "platform": "twitter",
    "content_type": "hot_take",
    "raw_content": "<the exact content you posted>",
    "ai_stack": ["<AI tools mentioned, e.g. Sora, Runway Gen-3, Kling>"],
    "external_refs": ["<the source URL from Step 1>"],
    "status": "posted"
  }
- Report the API response to confirm success.`;

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
    name: "research_and_post_morning",
    schedule: "0 10 * * *",
    message: RESEARCH_AND_POST_PROMPT,
    description: "Research AI filmmaking trends and post on X (10 AM daily)",
  },
  {
    name: "research_and_post_evening",
    schedule: "0 18 * * *",
    message: RESEARCH_AND_POST_PROMPT,
    description: "Research AI filmmaking trends and post on X (6 PM daily)",
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
