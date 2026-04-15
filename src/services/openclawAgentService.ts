/**
 * OpenClaw Agent Service — creates async Task records instead of
 * running the CLI directly via execSync.
 *
 * The actual execution is handled by the OpenClaw worker which polls
 * GET /api/tasks?status=pending and calls the status transition endpoints:
 *   PATCH /api/tasks/:id/start
 *   PATCH /api/tasks/:id/complete  { result }
 *   PATCH /api/tasks/:id/fail      { error_log }
 */
import { Task, ETaskType } from "../db/index.js";
import { settings } from "../config/settings.js";
import type { ITask } from "../db/index.js";

export interface CreateTaskOptions {
  type?: string;
  prompt: string;
  ref_id?: string;
  ref_collection?: string;
  payload?: Record<string, unknown>;
}

/**
 * Create a pending OpenClaw agent task and return the saved record.
 * The worker picks it up asynchronously.
 */
export async function createAgentTask(opts: CreateTaskOptions): Promise<ITask> {
  const task = await Task.create({
    type: opts.type ?? ETaskType.CRON_JOB,
    agent: settings.openClawAgent,
    prompt: opts.prompt,
    ref_id: opts.ref_id,
    ref_collection: opts.ref_collection,
    payload: opts.payload ?? {},
  });
  return task;
}
