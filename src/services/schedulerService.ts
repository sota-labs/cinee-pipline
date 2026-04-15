/** Scheduler service — OpenClaw isolated cron job management. */
import { log } from "../utils/logger.js";
import * as dotenv from "dotenv";
import { getActiveRoleConfig } from "./topicConfigService.js";
import {
  buildResearchPrompt,
  buildDraftPrompt,
  buildReplyPrompt,
  buildInteractPrompt,
} from "../prompts/index.js";
import {
  AUTO_LIKE_PROMPT,
  AUTO_BOOKMARK_PROMPT,
  SCRAPE_PROMPT,
} from "./schedulerPrompts.js";
import { Task, ETaskType, ETaskStatus, type ITask } from "../db/models/Task.js";
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

  const topicSuffix = role.name
    ? role.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
    : "default";

  return [
    {
      name: `scrape_x_notifications_${topicSuffix}`,
      schedule: "20 * * * *",
      message: SCRAPE_PROMPT,
      description:
        "Scrape X notifications and store replies (every hour at :20)",
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
      description:
        "Scrape X for topic posts and save to CurationSource DB (every 6 hours)",
    },
    {
      name: `research_and_draft_morning_${topicSuffix}`,
      schedule: "0 9 * * *",
      message: draftPrompt,
      description:
        "Read top research from DB and create draft for review (9 AM daily)",
    },
    {
      name: `research_and_draft_evening_${topicSuffix}`,
      schedule: "0 21 * * *",
      message: draftPrompt,
      description:
        "Read top research from DB and create draft for review (9 PM daily)",
    },
    {
      name: `auto_interact_hot_posts_${topicSuffix}`,
      schedule: "0 */4 * * *",
      message: interactPrompt,
      description:
        "Automatically post CEO-style comments on hot posts (every 4 hours)",
    },
    {
      name: `auto_like_posts_${topicSuffix}`,
      schedule: "0 10,22 * * *",
      message: AUTO_LIKE_PROMPT,
      description:
        "Automatically like posts (twice daily, ~5 posts each) for priority accounts and hot topics",
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

/**
 * Enqueue an openclaw command as a pending Task record.
 * The actual execution is handled by the task worker process.
 */
async function createOpenClawTask(
  type: ETaskType.CRON_JOB_ADD | ETaskType.CRON_JOB_REMOVE,
  args: string,
): Promise<ITask> {
  try {
    const task = await Task.create({
      type,
      agent: "openclaw",
      prompt: args,
      status: ETaskStatus.PENDING,
    });
    log.info(`[Task] Queued openclaw task: ${task._id} — ${args.slice(0, 80)}`);
    return task;
  } catch (error: unknown) {
    log.error(`[Task] Failed to create task: ${(error as Error).message}`);
    throw error;
  }
}

function buildAddCommand(job: CronJob): string {
  const escapedMessage = job.message.replace(/'/g, "'\\''");
  return `cron add --name "${job.name}" --cron "${job.schedule}" --tz "Asia/Ho_Chi_Minh" --session isolated --message '${escapedMessage}' --no-deliver --description "${job.description}"`;
}

function buildRemoveCommand(jobId: string): string {
  return `cron rm ${jobId}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function registerIsolatedJobs(): Promise<
  Record<string, unknown>[]
> {
  const results: Record<string, unknown>[] = [];
  const jobs = await buildCronJobs();

  for (const job of jobs) {
    try {
      const cmd = buildAddCommand(job);
      const task = await createOpenClawTask(ETaskType.CRON_JOB_ADD, cmd);
      log.info(`Registered: ${job.name} (${job.schedule})`);
      results.push({
        name: job.name,
        status: "queued",
        taskId: task._id.toString(),
      });
    } catch (error: unknown) {
      log.error(`Failed to register: ${job.name}`);
      results.push({
        name: job.name,
        status: "failed",
        error: (error as Error).message,
      });
    }
  }

  return results;
}

export interface ListedJob {
  id: string;
  name: string;
  description: string;
  status: string;
  createdAt: string;
  nextRunAt?: string;
}

/**
 * List registered cron-job tasks from the database.
 */
export async function listJobs(): Promise<{
  jobs: ListedJob[];
  total: number;
}> {
  try {
    const tasks = await Task.find({
      type: ETaskType.CRON_JOB_ADD,
      status: ETaskStatus.COMPLETED,
    })
      .sort({ created_at: -1 })
      .lean();

    const jobs: ListedJob[] = tasks.map((t) => {
      const nameMatch = t.prompt.match(/--name "([^"]+)"/);
      const descMatch = t.prompt.match(/--description "([^"]+)"/);
      const result_json = JSON.parse(t.result ?? "{}");
      const nextRunAt = result_json.state?.nextRunAtMs;
      return {
        id: String(t._id),
        name: nameMatch?.[1] ?? "unknown",
        description: descMatch?.[1] ?? "",
        status: t.status,
        createdAt: t.created_at.toISOString(),
        nextRunAt: nextRunAt ? new Date(nextRunAt).toISOString() : undefined,
      };
    });

    return { jobs, total: jobs.length };
  } catch (err: unknown) {
    log.error(`[Scheduler] listJobs failed: ${(err as Error).message}`);
    return { jobs: [], total: 0 };
  }
}

export async function removeAllJobs(): Promise<Record<string, unknown>[]> {
  try {
    const tasks = await Task.find({
      type: ETaskType.CRON_JOB_ADD,
      agent: "openclaw",
      prompt: { $regex: /^cron add / },
    }).lean();
    if (tasks.length === 0) {
      log.info("[Scheduler] No jobs found to remove");
      return [{ status: "no_jobs", message: "No cron jobs found" }];
    }

    const removableJobs = tasks.filter(
      (job) => job.status === ETaskStatus.COMPLETED,
    );

    for (const job of removableJobs) {
      await createOpenClawTask(
        ETaskType.CRON_JOB_REMOVE,
        buildRemoveCommand(job.completed_job_id!),
      );
    }

    const result = await Task.deleteMany({
      _id: { $in: tasks.map((job) => job._id) },
    });

    log.info(
      `[Scheduler] Queued ${removableJobs.length} removal command(s) and removed ${result.deletedCount} cron add task(s)`,
    );
    return [
      {
        status: "removed",
        removedCount: result.deletedCount,
        removalQueuedCount: removableJobs.length,
        removalSkippedCount: tasks.length - removableJobs.length,
      },
    ];
  } catch (error: unknown) {
    log.error(`[Scheduler] removeAllJobs failed: ${(error as Error).message}`);
    return [{ status: "failed", error: (error as Error).message }];
  }
}

export async function registerSingleJob(
  jobName: string,
): Promise<Record<string, unknown>> {
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
    const task = await createOpenClawTask(ETaskType.CRON_JOB_ADD, cmd);
    log.info(`Registered: ${job.name} (${job.schedule})`);
    return { name: job.name, status: "queued", taskId: task._id.toString() };
  } catch (error: unknown) {
    log.error(`Failed to register: ${job.name}`);
    return {
      name: job.name,
      status: "failed",
      error: (error as Error).message,
    };
  }
}

export async function removeSingleJob(
  jobId: string,
): Promise<Record<string, unknown>> {
  try {
    const existing = await Task.findOne({ completed_job_id: jobId });
    if (!existing) {
      return { id: jobId, status: "not_found", error: "Job not found" };
    }

    await createOpenClawTask(
      ETaskType.CRON_JOB_REMOVE,
      buildRemoveCommand(existing.completed_job_id!),
    );
    const result = await Task.findOneAndDelete({ completed_job_id: jobId });
    if (!result) {
      return { id: jobId, status: "not_found", error: "Job not found" };
    }

    log.info(`[Scheduler] Removed job: ${jobId}`);
    return { id: jobId, status: "removed", removalQueued: true };
  } catch (error: unknown) {
    return { id: jobId, status: "failed", error: (error as Error).message };
  }
}

export async function triggerSingleJob(
  jobId: string,
): Promise<Record<string, unknown>> {
  try {
    const existing = await Task.findOne({ completed_job_id: jobId });
    if (!existing) {
      return { id: jobId, status: "not_found", error: "Job not found" };
    }
    return { id: jobId, status: "queued", taskId: existing._id.toString() };
  } catch (error: unknown) {
    return { id: jobId, status: "failed", error: (error as Error).message };
  }
}

export async function checkGateway(): Promise<boolean> {
  try {
    await Task.findOne().lean();
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
 * Used by contentReview routes.
 */
export async function getDraftPrompt(): Promise<string> {
  const role = await getActiveRoleConfig();
  return buildDraftPrompt(role, API);
}
