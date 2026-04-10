/** Scheduler service — OpenClaw isolated cron job management. */
import { execSync } from "child_process";
import { log } from "../utils/logger.js";
import * as dotenv from "dotenv";
import { settings } from "../config/settings.js";
import { getActiveRoleConfig } from "./topicConfigService.js";
import {
  buildResearchPrompt,
  buildDraftPrompt,
  buildReplyPrompt,
  buildInteractPrompt,
} from "../prompts/index.js";
import { AUTO_LIKE_PROMPT, AUTO_BOOKMARK_PROMPT, SCRAPE_PROMPT } from "./schedulerPrompts.js";
dotenv.config();

const API = process.env.PUBLIC_API_URL || "http://localhost:3000";

interface CronJob {
  name: string;
  schedule: string;
  message: string;
  description: string;
}

// ── Job definitions (built dynamically from active role config) ───────────────

async function buildCronJobs(): Promise<CronJob[]> {
  const role = await getActiveRoleConfig();
  const researchPrompt = buildResearchPrompt(role, API);
  const draftPrompt = buildDraftPrompt(role, API);
  const replyPrompt = buildReplyPrompt(role, API);
  const interactPrompt = buildInteractPrompt(role, API);

  return [
    {
      name: "scrape_x_notifications",
      schedule: "20 * * * *",
      message: SCRAPE_PROMPT,
      description: "Scrape X notifications and store replies (every hour at :20)",
    },
    {
      name: "reply_x_notifications",
      schedule: "40 * * * *",
      message: replyPrompt,
      description: "Auto-reply on X and update status (every hour at :40)",
    },
    {
      name: "research_and_collect",
      schedule: "0 */6 * * *",
      message: researchPrompt,
      description:
        "Scrape X for topic posts and save to CurationSource DB (every 6 hours)",
    },
    {
      name: "research_and_draft_morning",
      schedule: "0 9 * * *",
      message: draftPrompt,
      description:
        "Read top research from DB and create draft for review (9 AM daily)",
    },
    {
      name: "research_and_draft_evening",
      schedule: "0 21 * * *",
      message: draftPrompt,
      description:
        "Read top research from DB and create draft for review (9 PM daily)",
    },
    {
      name: "auto_interact_hot_posts",
      schedule: "0 */4 * * *",
      message: interactPrompt,
      description:
        "Tự động comment dạo phong cách CEO vào các bài viết hot (mỗi 4 tiếng)",
    },
    {
      name: "auto_like_posts",
      schedule: "0 10,22 * * *",
      message: AUTO_LIKE_PROMPT,
      description:
        "Tự động thả like (ngày 2 lần, mỗi lần ~5 bài) cho priority accounts và hot posts",
    },
    {
      name: "auto_bookmark_posts",
      schedule: "0 14 */2 * *",
      message: AUTO_BOOKMARK_PROMPT,
      description: "Tự động bookmark 1 post hay (mỗi 2 ngày)",
    },
  ];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function runOpenClaw(args: string): string {
  try {
    return execSync(`openclaw ${args}`, {
      encoding: "utf-8",
      timeout: 300_000,
    }).trim();
  } catch (error: unknown) {
    log.error(`OpenClaw error: ${(error as Error).message}`);
    throw error;
  }
}

function buildAddCommand(job: CronJob): string {
  const escapedMessage = job.message.replace(/'/g, "'\\''");
  return `cron add --name "${job.name}" --cron "${job.schedule}" --tz "Asia/Ho_Chi_Minh" --session isolated --message '${escapedMessage}' --no-deliver --description "${job.description}"`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function registerIsolatedJobs(): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  const jobs = await buildCronJobs();

  for (const job of jobs) {
    try {
      const cmd = buildAddCommand(job);
      const output = runOpenClaw(cmd);
      log.info(`Registered: ${job.name} (${job.schedule})`);
      results.push({ name: job.name, status: "registered", output });
    } catch (error: unknown) {
      log.error(`Failed to register: ${job.name}`);
      results.push({ name: job.name, status: "failed", error: (error as Error).message });
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

export async function removeAllJobs(): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  const jobs = await buildCronJobs();

  for (const job of jobs) {
    try {
      const output = runOpenClaw(`cron rm ${job.name}`);
      results.push({ name: job.name, status: "removed", output });
    } catch (error: unknown) {
      results.push({ name: job.name, status: "failed", error: (error as Error).message });
    }
  }

  return results;
}

export async function registerSingleJob(jobName: string): Promise<Record<string, unknown>> {
  const jobs = await buildCronJobs();
  const job = jobs.find((j) => j.name === jobName);
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
  } catch (error: unknown) {
    log.error(`Failed to register: ${job.name}`);
    return { name: job.name, status: "failed", error: (error as Error).message };
  }
}

export async function removeSingleJob(jobName: string): Promise<Record<string, unknown>> {
  const jobs = await buildCronJobs();
  const job = jobs.find((j) => j.name === jobName);
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
  } catch (error: unknown) {
    return { name: job.name, status: "failed", error: (error as Error).message };
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

export async function getJobDefinitions(): Promise<CronJob[]> {
  return buildCronJobs();
}

/**
 * Get the DRAFT prompt with the currently active role config.
 * Used by telegram.ts for NEXT_SOURCE action.
 */
export async function getDraftPrompt(): Promise<string> {
  const role = await getActiveRoleConfig();
  return buildDraftPrompt(role, API);
}
