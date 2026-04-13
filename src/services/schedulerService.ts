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

  const topicSuffix = role.name ? role.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase() : "default";

  return [
    {
      name: `scrape_x_notifications_${topicSuffix}`,
      schedule: "20 * * * *",
      message: SCRAPE_PROMPT,
      description: "Scrape X notifications and store replies (every hour at :20)",
    },
    {
      name: `reply_x_notifications_${topicSuffix}`,
      schedule: "40 * * * *",
      message: replyPrompt,
      description: "Auto-reply on X and update status (every hour at :40)",
    },
    {
      name: `research_and_collect_${topicSuffix}`,
      schedule: "0 */6 * * *",
      message: researchPrompt,
      description: "Scrape X for topic posts and save to CurationSource DB (every 6 hours)",
    },
    {
      name: `research_and_draft_morning_${topicSuffix}`,
      schedule: "0 9 * * *",
      message: draftPrompt,
      description: "Read top research from DB and create draft for review (9 AM daily)",
    },
    {
      name: `research_and_draft_evening_${topicSuffix}`,
      schedule: "0 21 * * *",
      message: draftPrompt,
      description: "Read top research from DB and create draft for review (9 PM daily)",
    },
    {
      name: `auto_interact_hot_posts_${topicSuffix}`,
      schedule: "0 */4 * * *",
      message: interactPrompt,
      description: "Automatically post CEO-style comments on hot posts (every 4 hours)",
    },
    {
      name: `auto_like_posts_${topicSuffix}`,
      schedule: "0 10,22 * * *",
      message: AUTO_LIKE_PROMPT,
      description: "Automatically like posts (twice daily, ~5 posts each) for priority accounts and hot topics",
    },
    {
      name: `auto_bookmark_posts_${topicSuffix}`,
      schedule: "0 14 */2 * *",
      message: AUTO_BOOKMARK_PROMPT,
      description: "Automatically bookmark a high-quality post (every 2 days)",
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

export interface ListedJob {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  schedule: { kind: string; expr: string; tz: string };
}

/**
 * Parse the plain-text table output from `openclaw cron list`.
 * Each data row starts with a UUID followed by space-padded columns:
 * ID   Name   Schedule   Next   Last   Status   Target   Agent ID   Model
 */
function parseOpenClawList(output: string): ListedJob[] {
  const jobs: ListedJob[] = [];
  const uuidRegex = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s+(.+)$/;

  for (const line of output.split("\n")) {
    const match = uuidRegex.exec(line.trim());
    if (!match) continue;

    const id = match[1];
    // Split remaining columns by 2+ consecutive spaces
    const cols = match[2].split(/\s{2,}/).filter(Boolean);

    // cols: [name, schedule, next, last, status, target, agentId, model]
    const rawName = (cols[0] ?? "").trim();
    const rawSchedule = (cols[1] ?? "").trim();
    const status = (cols[4] ?? "idle").trim();

    // name may be truncated with "..." — keep as-is
    const name = rawName;

    // schedule: "cron 40 * * * * @ Asia/Ho_Chi_Minh" (may be truncated)
    const schedMatch = rawSchedule.match(/^cron\s+(.+?)\s+@\s+(.+)/);
    const expr = schedMatch ? schedMatch[1].trim() : rawSchedule;
    const tz = schedMatch ? schedMatch[2].replace(/\.\.\..*$/, "").trim() : "UTC";

    jobs.push({
      id,
      name,
      description: "",
      enabled: ["ok", "idle", "running"].includes(status),
      schedule: { kind: "cron", expr, tz },
    });
  }

  return jobs;
}

export function listJobs(): { jobs: ListedJob[]; total: number } {
  try {
    const output = runOpenClaw("cron list");
    const jobs = parseOpenClawList(output);
    return { jobs, total: jobs.length };
  } catch (err: unknown) {
    log.error(`[Scheduler] listJobs failed: ${(err as Error).message}`);
    return { jobs: [], total: 0 };
  }
}

/**
 * Extract all job IDs from `openclaw cron list` plain text output.
 */
function parseJobIds(): string[] {
  try {
    const output = runOpenClaw("cron list");
    const uuidRegex = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s/gm;
    const ids: string[] = [];
    let m;
    while ((m = uuidRegex.exec(output)) !== null) {
      ids.push(m[1]);
    }
    return ids;
  } catch (err: unknown) {
    log.error(`[Scheduler] parseJobIds failed: ${(err as Error).message}`);
    return [];
  }
}

export async function removeAllJobs(): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  const jobIds = parseJobIds();

  if (jobIds.length === 0) {
    log.info("[Scheduler] No jobs found to remove");
    return [{ status: "no_jobs", message: "No cron jobs found" }];
  }

  for (const id of jobIds) {
    try {
      const output = runOpenClaw(`cron rm ${id}`);
      log.info(`[Scheduler] Removed job: ${id}`);
      results.push({ id, status: "removed", output });
    } catch (error: unknown) {
      log.error(`[Scheduler] Failed to remove job: ${id}`);
      results.push({ id, status: "failed", error: (error as Error).message });
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

export async function removeSingleJob(jobId: string): Promise<Record<string, unknown>> {
  try {
    const output = runOpenClaw(`cron rm ${jobId}`);
    return { id: jobId, status: "removed", output };
  } catch (error: unknown) {
    return { id: jobId, status: "failed", error: (error as Error).message };
  }
}

export async function triggerSingleJob(jobId: string): Promise<Record<string, unknown>> {
  try {
    const output = runOpenClaw(`cron trigger ${jobId}`);
    return { id: jobId, status: "triggered", output };
  } catch (error: unknown) {
    return { id: jobId, status: "failed", error: (error as Error).message };
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
