/** Scheduler service — OpenClaw cron job management, ported from scheduler/openclaw_config.py. */
import { execSync } from "child_process";
import { log } from "../utils/logger.js";

interface CronJob {
  name: string;
  schedule: string;
  command: string;
  description: string;
}

const PIPELINE_JOBS: CronJob[] = [
  {
    name: "daily_planning",
    schedule: "0 9 * * *",
    command: "npx tsx src/scripts/runPlanning.ts",
    description: "Daily strategy + content planning (9 AM)",
  },
  {
    name: "amplification",
    schedule: "0 */3 * * *",
    command: "npx tsx src/scripts/runAmplification.ts",
    description: "AI film amplification (every 3 hours)",
  },
  {
    name: "hot_take",
    schedule: "0 14 * * *",
    command: "npx tsx src/scripts/runHotTake.ts",
    description: "CEO hot take (2 PM daily)",
  },
  {
    name: "engagement",
    schedule: "0 */2 * * *",
    command: "npx tsx src/scripts/runEngagement.ts",
    description: "Twitter engagement (every 2 hours)",
  },
  {
    name: "mention_check",
    schedule: "*/30 * * * *",
    command: "npx tsx src/scripts/runMentions.ts",
    description: "Mention check & reply (every 30 mins)",
  },
  {
    name: "reddit_discussion",
    schedule: "0 */4 * * *",
    command: "npx tsx src/scripts/runReddit.ts",
    description: "Reddit discussion (every 4 hours)",
  },
];

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

export function registerAllJobs(): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];

  for (const job of PIPELINE_JOBS) {
    try {
      // NOTE: OpenClaw doesn't execute arbitrary commands directly via its cron.
      // We will create system events that a local openclaw hooked agent could handle,
      // or we can use standard system crontab instead if we want to run node scripts.
      // But assuming openclaw has a mechanism to hit webhooks or run local commands:
      // The CLI syntax is: openclaw cron add --name "job_name" --cron "schedule" --system-event "payload"
      const payload = JSON.stringify({ action: "run_pipeline_job", job: job.name });
      const cmd = `cron add --name "${job.name}" --cron "${job.schedule}" --system-event '${payload}' --description "${job.description}"`;
      const output = runOpenClaw(cmd);
      log.info(`✓ Registered: ${job.name} (${job.schedule})`);
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
