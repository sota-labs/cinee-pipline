/** Scheduler service — OpenClaw cron job management. */
import { execSync } from "child_process";
import { log } from "../utils/logger.js";

interface CronJobBase {
  name: string;
  schedule: string;
  description: string;
}

interface SystemEventJob extends CronJobBase {
  type: "system-event";
  command: string;
}

interface IsolatedMessageJob extends CronJobBase {
  type: "isolated";
  message: string;
}

type CronJob = SystemEventJob | IsolatedMessageJob;

// ── Prompt definitions (kept as template literals for readability) ───────────

const SCRAPE_PROMPT = `Open https://x.com/notifications in the browser. \
Find all notification items that are comments or replies from the last 24 hours. \
For each comment, extract its URL and the comment text content. \
Then send a single POST request to https://takako-braw-xenia.ngrok-free.dev/api/tools/db/replies \
with a JSON body that is an array of reply objects. Each object must have: \
reply_content (the comment text), \
tone_used ("supportive"), \
status ("draft"), \
platform ("x"), \
url (the full URL of the comment on X), \
created_at (current ISO timestamp), \
updated_at (current ISO timestamp). \
Do NOT skip any comment from the last 24 hours. Scroll the notifications page to load more if needed.`;

const REPLY_PROMPT = `Step 1: Call GET https://takako-braw-xenia.ngrok-free.dev/api/tools/db/replies to fetch the list of replies. \
Step 2: For each reply in the response that has status "draft" or "resolved": \
  a) Open the reply "url" field in the browser. \
  b) Post a reply on X using the "reply_content" field as the reply text. \
  c) Wait 5 seconds before processing the next reply. \
  d) After successfully replying, call PATCH https://takako-braw-xenia.ngrok-free.dev/api/tools/db/replies \
     with JSON body: { "_id": "<the reply _id>", "status": "replied" }. \
Process all matching replies sequentially with 5-second gaps. Do not skip any.`;

// ── Job definitions ─────────────────────────────────────────────────────────

const PIPELINE_JOBS: CronJob[] = [
  // ── Existing jobs (system-event / main session) ──
  {
    type: "system-event",
    name: "daily_planning",
    schedule: "0 9 * * *",
    command: "npx tsx src/scripts/runPlanning.ts",
    description: "Daily strategy + content planning (9 AM)",
  },
  {
    type: "system-event",
    name: "amplification",
    schedule: "0 */3 * * *",
    command: "npx tsx src/scripts/runAmplification.ts",
    description: "AI film amplification (every 3 hours)",
  },
  {
    type: "system-event",
    name: "hot_take",
    schedule: "0 14 * * *",
    command: "npx tsx src/scripts/runHotTake.ts",
    description: "CEO hot take (2 PM daily)",
  },
  {
    type: "system-event",
    name: "engagement",
    schedule: "0 */2 * * *",
    command: "npx tsx src/scripts/runEngagement.ts",
    description: "Twitter engagement (every 2 hours)",
  },
  {
    type: "system-event",
    name: "mention_check",
    schedule: "*/30 * * * *",
    command: "npx tsx src/scripts/runMentions.ts",
    description: "Mention check & reply (every 30 mins)",
  },
  {
    type: "system-event",
    name: "reddit_discussion",
    schedule: "0 */4 * * *",
    command: "npx tsx src/scripts/runReddit.ts",
    description: "Reddit discussion (every 4 hours)",
  },

  // ── New isolated-session jobs (OpenClaw agent runs the prompt) ──
  {
    type: "isolated",
    name: "scrape_x_notifications",
    schedule: "0 * * * *",
    message: SCRAPE_PROMPT,
    description: "Scrape X notifications and store replies (every hour at :00)",
  },
  {
    type: "isolated",
    name: "reply_x_notifications",
    schedule: "30 * * * *",
    message: REPLY_PROMPT,
    description: "Auto-reply on X and update status (every hour at :30)",
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
  if (job.type === "system-event") {
    const payload = JSON.stringify({ action: "run_pipeline_job", job: job.name });
    return `cron add --name "${job.name}" --cron "${job.schedule}" --system-event '${payload}' --description "${job.description}"`;
  }

  // Isolated-session job: OpenClaw agent runs the prompt autonomously
  const escapedMessage = job.message.replace(/'/g, "'\\''");
  return `cron add --name "${job.name}" --cron "${job.schedule}" --tz "Asia/Ho_Chi_Minh" --session isolated --message '${escapedMessage}' --no-deliver --description "${job.description}"`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function registerAllJobs(): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];

  for (const job of PIPELINE_JOBS) {
    try {
      const cmd = buildAddCommand(job);
      const output = runOpenClaw(cmd);
      log.info(`✓ Registered: ${job.name} (${job.schedule}) [${job.type}]`);
      results.push({ name: job.name, type: job.type, status: "registered", output });
    } catch (error: any) {
      log.error(`✗ Failed to register: ${job.name}`);
      results.push({ name: job.name, type: job.type, status: "failed", error: error.message });
    }
  }

  return results;
}

export function registerIsolatedJobs(): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  const isolatedJobs = PIPELINE_JOBS.filter((j) => j.type === "isolated");

  for (const job of isolatedJobs) {
    try {
      const cmd = buildAddCommand(job);
      const output = runOpenClaw(cmd);
      log.info(`✓ Registered: ${job.name} (${job.schedule}) [isolated]`);
      results.push({ name: job.name, status: "registered", output });
    } catch (error: any) {
      log.error(`✗ Failed to register: ${job.name}`);
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

  for (const job of PIPELINE_JOBS) {
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
    runOpenClaw(`health`);
    return true;
  } catch {
    return false;
  }
}

export function getJobDefinitions(): CronJob[] {
  return PIPELINE_JOBS;
}
