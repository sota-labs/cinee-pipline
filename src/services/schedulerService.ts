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
  name?: string;
  schedule?: string;
  [key: string]: unknown;
}

/**
 * List all registered cron jobs with their IDs.
 * Tries --json first for structured data, falls back to text parsing.
 */
export function listJobs(): { jobs: ListedJob[]; raw: string } {
  // Try JSON format first
  try {
    const jsonOutput = runOpenClaw("cron list --json");
    const parsed = JSON.parse(jsonOutput);
    const jobs: ListedJob[] = (Array.isArray(parsed) ? parsed : (parsed.jobs ?? parsed.data ?? []))
      .map((j: Record<string, unknown>) => ({ ...j, id: String(j.id) }));
    return { jobs, raw: jsonOutput };
  } catch {
    // --json not supported, fall back to plain text
  }

  // Fallback: parse plain text
  try {
    const textOutput = runOpenClaw("cron list");
    const uuidRegex = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi;
    const jobs: ListedJob[] = [];
    const seen = new Set<string>();

    for (const line of textOutput.split("\n")) {
      const match = uuidRegex.exec(line);
      if (match && !seen.has(match[1])) {
        seen.add(match[1]);
        jobs.push({ id: match[1], name: line.trim() });
      }
      uuidRegex.lastIndex = 0;
    }

    return { jobs, raw: textOutput };
  } catch {
    return { jobs: [], raw: "Failed to list jobs" };
  }
}

/**
 * Parse job IDs from `openclaw cron list --json` output.
 * Expects an array of objects with an `id` field.
 * Falls back to parsing plain text output if --json is not supported.
 */
function parseJobIds(): string[] {
  // Try JSON format first
  try {
    const jsonOutput = runOpenClaw("cron list --json");
    const parsed = JSON.parse(jsonOutput);
    const jobs = Array.isArray(parsed) ? parsed : (parsed.jobs ?? parsed.data ?? []);
    return jobs.map((j: Record<string, unknown>) => String(j.id)).filter(Boolean);
  } catch {
    // --json not supported or parse failed, fall back to plain text
  }

  // Fallback: parse plain text output for UUIDs or ID-like strings
  try {
    const textOutput = runOpenClaw("cron list");
    // Match common UUID pattern (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    const uuidRegex = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
    const matches = textOutput.match(uuidRegex);
    if (matches && matches.length > 0) {
      return [...new Set(matches)]; // deduplicate
    }

    // Try matching any ID-like pattern at the start of lines (e.g. numeric IDs)
    const lineIdRegex = /^(\S+)\s+/gm;
    const ids: string[] = [];
    let m;
    while ((m = lineIdRegex.exec(textOutput)) !== null) {
      // Skip header-like lines
      if (!/^(id|name|ID|NAME|---|#)/i.test(m[1])) {
        ids.push(m[1]);
      }
    }
    return ids;
  } catch {
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
