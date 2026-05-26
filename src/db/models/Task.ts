/** Task — async job queue for OpenClaw agent invocations. */
import { Schema, model, Document } from "mongoose";

export enum ETaskStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
}

export enum ETaskType {
  POST_NOW = "post_now",
  AI_REWRITE = "ai_rewrite",
  SCAN_AND_POST = "scan_and_post",
  CRON_JOB_ADD = "cron_job_add",
  CRON_JOB_REMOVE = "cron_job_remove",
  CRON_JOB_TRIGGER = "cron_job_trigger",
  SINGLE_TASK_TRIGGER = "single_task_trigger",
  KOL_COMMENT_CRAWL = "kol_comment_crawl",
  SHELL_EXEC = "shell_exec",
}

export interface ITask extends Document {
  /** Task category — drives what the worker does with it. */
  type: string;
  /** OpenClaw agent name to run (e.g. "main"). */
  agent: string;
  /** Full prompt/message to pass to the agent. */
  prompt: string;
  /** ID of the related document (e.g. Post._id). */
  ref_id?: string;
  /** Collection the ref_id belongs to (e.g. "posts"). */
  ref_collection?: string;
  /** Free-form context data the worker may need (instruction, userPrompt, etc.). */
  payload?: Record<string, unknown>;
  status: ETaskStatus;
  /** Execution priority — higher value picked first. 0 = non-KOL tasks. */
  priority: number;
  /** KOL handle this task belongs to. null for non-KOL tasks. */
  handle_group?: string | null;
  /** Raw text output returned by the agent on success. */
  result?: string;
  /** Error message / stack logged when status = failed. */
  error_log?: string;
  started_at?: Date;
  completed_at?: Date;
  completed_job_id?: string;
  created_at: Date;
  updated_at: Date;
}

const taskSchema = new Schema<ITask>(
  {
    type: { type: String, required: true, index: true },
    agent: { type: String, required: true },
    prompt: { type: String, required: true },
    ref_id: { type: String, index: true },
    ref_collection: { type: String },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: Object.values(ETaskStatus),
      default: ETaskStatus.PENDING,
      index: true,
    },
    priority: { type: Number, default: 0 },
    handle_group: { type: String, default: null },
    result: { type: String },
    error_log: { type: String },
    started_at: { type: Date },
    completed_at: { type: Date },
    completed_job_id: { type: String },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

taskSchema.index({ status: 1, created_at: 1 });
taskSchema.index({ status: 1, priority: -1, created_at: 1 });
taskSchema.index({ ref_id: 1, type: 1 });

export const Task = model<ITask>("Task", taskSchema);
