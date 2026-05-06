/** Task queue routes — CRUD and status management for async OpenClaw agent jobs. */
import { Router, type Request, type Response } from "express";
import { Task, ETaskStatus } from "../db/index.js";
import { log } from "../utils/logger.js";

export const tasksRouter = Router();

// ── List ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/tasks
 * Query: status, type, ref_id, limit (default 20), skip (default 0)
 */
tasksRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { status, type, ref_id, limit = "20", skip = "0" } = req.query;
    const filter: Record<string, unknown> = {};

    if (status) {
      const statuses = (status as string)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
    }
    if (type) filter.type = type;
    if (ref_id) filter.ref_id = ref_id;

    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .sort({ created_at: -1 })
        .skip(parseInt(skip as string))
        .limit(parseInt(limit as string)),
      Task.countDocuments(filter),
    ]);

    res.json({ success: true, tasks, total });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Get single ────────────────────────────────────────────────────────────────

/** GET /api/tasks/:id */
tasksRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task)
      return res.status(404).json({ success: false, error: "Task not found" });
    res.json({ success: true, task });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Status transitions (called by the OpenClaw worker) ───────────────────────

/**
 * PATCH /api/tasks/:id/start
 * Worker calls this when it picks up the task.
 * Transitions: pending → processing
 */
tasksRouter.patch("/:id/start", async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task)
      return res.status(404).json({ success: false, error: "Task not found" });

    if (task.status !== ETaskStatus.PENDING) {
      return res.status(409).json({
        success: false,
        error: `Cannot start task with status "${task.status}" — expected "pending"`,
      });
    }

    task.status = ETaskStatus.PROCESSING;
    task.started_at = new Date();
    await task.save();

    log.info(`Task ${task._id} (${task.type}) → processing`);
    res.json({ success: true, task });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * PATCH /api/tasks/:id/complete
 * Worker calls this when the job finishes successfully.
 * Body: { result?: string }
 * Transitions: processing → completed
 */
tasksRouter.patch("/:id/complete", async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task)
      return res.status(404).json({ success: false, error: "Task not found" });

    if (task.status !== ETaskStatus.PROCESSING) {
      return res.status(409).json({
        success: false,
        error: `Cannot complete task with status "${task.status}" — expected "processing"`,
      });
    }

    task.status = ETaskStatus.COMPLETED;
    task.completed_at = new Date();

    const rawResult = req.body?.result ?? "";
    try {
      const parsed = JSON.parse(rawResult);
      task.completed_job_id = parsed.id ?? "";
    } catch {
      task.completed_job_id = "";
    }
    task.result = rawResult;
    await task.save();

    log.info(`Task ${task._id} (${task.type}) → completed`);
    res.json({ success: true, task });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * PATCH /api/tasks/:id/fail
 * Worker calls this when the job fails.
 * Body: { error_log: string }
 * Transitions: processing → failed
 */
tasksRouter.patch("/:id/fail", async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task)
      return res.status(404).json({ success: false, error: "Task not found" });

    if (task.status !== ETaskStatus.PROCESSING) {
      return res.status(409).json({
        success: false,
        error: `Cannot fail task with status "${task.status}" — expected "processing"`,
      });
    }

    task.status = ETaskStatus.FAILED;
    task.error_log = req.body.error_log ?? "Unknown error";
    task.completed_at = new Date();
    await task.save();

    log.error(`Task ${task._id} (${task.type}) → failed: ${task.error_log}`);
    res.json({ success: true, task });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * PATCH /api/tasks/:id/retry
 * Reset a failed task back to pending so it can be picked up again.
 * Transitions: failed → pending
 */
tasksRouter.patch("/:id/retry", async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task)
      return res.status(404).json({ success: false, error: "Task not found" });

    if (task.status !== ETaskStatus.FAILED) {
      return res.status(409).json({
        success: false,
        error: `Cannot retry task with status "${task.status}" — expected "failed"`,
      });
    }

    task.status = ETaskStatus.PENDING;
    task.error_log = undefined;
    task.result = undefined;
    task.started_at = undefined;
    task.completed_at = undefined;
    await task.save();

    log.info(`Task ${task._id} (${task.type}) → retrying (reset to pending)`);
    res.json({ success: true, task });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Delete ────────────────────────────────────────────────────────────────────

/** DELETE /api/tasks/:id */
tasksRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task)
      return res.status(404).json({ success: false, error: "Task not found" });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});
