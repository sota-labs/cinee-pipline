/** Task queue routes — CRUD and status management for async OpenClaw agent jobs. */
import { Router, type Request, type Response } from "express";
import { Task, ETaskStatus, ETaskType } from "../db/index.js";
import { log } from "../utils/logger.js";
import { extractResponse } from "../utils/extractResponse.js";
import { processBatchCrawlResult } from "../services/kolCrawlerService.js";
import {
  processPostAnalysisResult,
  processCommentPatternResult,
  processPersonalityResult,
  kolAnalyzerService,
} from "../services/kolAnalyzerService.js";
import { replyEngineService } from "../services/replyEngineService.js";
import { ownAccountService } from "../services/ownAccountService.js";
import { selfReplyService } from "../services/selfReplyService.js";

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

    const rawResult = extractResponse(req.body?.result ?? "");
    try {
      const parsed = JSON.parse(rawResult);
      task.completed_job_id = parsed.id ?? "";
    } catch {
      task.completed_job_id = "";
    }
    task.result = rawResult;
    await task.save();

    // Trigger automated pipeline hooks for background analysis/suggestions
    if (task.payload && typeof task.payload === "object") {
      const payload = task.payload as Record<string, unknown>;
      
      // Handle post analysis hooks
      if (payload.analysisType && payload.relatedId) {
        const relatedId = String(payload.relatedId);
        
        // Use setImmediate to avoid blocking the API response to the worker
        setImmediate(async () => {
          try {
            if (payload.analysisType === "post_analysis") {
              const result = await processPostAnalysisResult(relatedId, rawResult);
              if (result) {
                await kolAnalyzerService.applyAnalysisResults(relatedId, result);
                log.info(`[Webhook] Applied post_analysis to post ${relatedId}, triggering generateSuggestions`);
                // Auto-trigger suggestion generation
                await replyEngineService.generateSuggestions(relatedId);
              }
            } else if (payload.analysisType === "comment_pattern") {
              const result = await processCommentPatternResult(relatedId, rawResult);
              if (result) {
                await kolAnalyzerService.applyAnalysisResults(relatedId, {} as any, result);
                log.info(`[Webhook] Applied comment_pattern to post ${relatedId}`);
              }
            } else if (payload.analysisType === "personality") {
              const result = await processPersonalityResult(relatedId, rawResult);
              if (result) {
                // Not sure if there is an applyPersonalityUpdate function, let's assume it logs for now if missing
                log.info(`[Webhook] Applied personality to KOL ${relatedId}`);
                if ((kolAnalyzerService as any).applyPersonalityUpdate) {
                  await (kolAnalyzerService as any).applyPersonalityUpdate(relatedId, result);
                }
              }
            }
          } catch (e: any) {
            log.error(`[Webhook] Error processing analysis ${payload.analysisType}: ${e.message}`);
          }
        });
      }
      
      // Handle suggestion generation hooks
      if (payload.action === "generate_suggestions" && payload.suggestionId) {
        const suggestionId = String(payload.suggestionId);
        setImmediate(async () => {
          try {
            log.info(`[Webhook] Processing generated suggestions for ${suggestionId}`);
            await replyEngineService.processGeneratedSuggestions(suggestionId, rawResult);
          } catch (e: unknown) {
            log.error(`[Webhook] Error processing generated suggestions: ${(e as Error).message}`);
          }
        });
      }

      // Handle own-account personality learning result
      if (payload.analysisType === "own_account_personality") {
        setImmediate(async () => {
          try {
            await ownAccountService.applyLearnedProfile(rawResult);
            log.info("[Webhook] Applied own_account_personality learning result");
          } catch (e: unknown) {
            log.error(`[Webhook] Error applying own_account_personality: ${(e as Error).message}`);
          }
        });
      }

      // Handle reply execution result
      if (payload.action === "execute_reply" && payload.suggestionId) {
        const suggestionId = String(payload.suggestionId);
        setImmediate(async () => {
          try {
            await replyEngineService.processExecutionResult(suggestionId, rawResult);
            log.info(`[Webhook] Processed execute_reply result for suggestion ${suggestionId}`);
          } catch (e: unknown) {
            log.error(`[Webhook] Error processing execute_reply: ${(e as Error).message}`);
          }
        });
      }

      // Handle self-reply execution result
      if (payload.action === "execute_self_reply" && payload.queueId && payload.commentId) {
        const queueId = String(payload.queueId);
        const commentId = String(payload.commentId);
        setImmediate(async () => {
          try {
            await selfReplyService.processExecutionComplete(queueId, commentId);
            log.info(`[Webhook] execute_self_reply complete for comment ${commentId}`);
          } catch (e: unknown) {
            log.error(`[Webhook] Error in execute_self_reply complete: ${(e as Error).message}`);
          }
        });
      }

      // Handle self-reply AI generation result
      if (payload.analysisType === "self_reply_generation") {
        const refId = String(payload.ref_id ?? "");
        const commentId = String(payload.comment_id ?? "");
        if (refId && commentId) {
          setImmediate(async () => {
            try {
              await selfReplyService.processSelfReplyResult(refId, commentId, rawResult);
              log.info(`[Webhook] Processed self_reply_generation for comment ${commentId}`);
            } catch (e: unknown) {
              log.error(`[Webhook] Error processing self_reply_generation: ${(e as Error).message}`);
            }
          });
        }
      }

      // Handle batch crawl completion — auto process results and trigger analysis
      if (payload.action === "batch_crawl" && Array.isArray(payload.handles)) {
        const handles = payload.handles as string[];
        setImmediate(async () => {
          try {
            log.info(`[Webhook] Auto-processing batch_crawl result for task ${task._id}`);
            const results = await processBatchCrawlResult(task.result!, handles);
            log.info(`[Webhook] batch_crawl processed: ${results.length} KOLs`);
          } catch (e: unknown) {
            log.error(`[Webhook] Error processing batch_crawl result: ${(e as Error).message}`);
          }
        });
      }
    }

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

    // Mark suggestion as failed if this was a reply execution task
    if (task.payload && typeof task.payload === "object") {
      const payload = task.payload as Record<string, unknown>;
      if (payload.action === "execute_reply" && payload.suggestionId) {
        const suggestionId = String(payload.suggestionId);
        setImmediate(async () => {
          try {
            await replyEngineService.processExecutionResult(
              suggestionId,
              JSON.stringify({ success: false, error: task.error_log }),
            );
            log.info(`[Webhook] Marked execute_reply suggestion ${suggestionId} as failed`);
          } catch (e: unknown) {
            log.error(`[Webhook] Error marking execute_reply failed: ${(e as Error).message}`);
          }
        });
      }

      if (payload.action === "execute_self_reply" && payload.queueId && payload.commentId) {
        const queueId = String(payload.queueId);
        const commentId = String(payload.commentId);
        setImmediate(async () => {
          try {
            await selfReplyService.processExecutionFailed(queueId, commentId, task.error_log ?? "");
            log.info(`[Webhook] execute_self_reply failed for comment ${commentId}`);
          } catch (e: unknown) {
            log.error(`[Webhook] Error in execute_self_reply fail: ${(e as Error).message}`);
          }
        });
      }
    }

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

// ── Process Result ────────────────────────────────────────────────────────────

/**
 * POST /api/tasks/:id/process-result
 * Process a completed batch_crawl task result: parse JSON, save KolPost records.
 * Idempotent — re-processing deduplicates via post_url unique index.
 */
tasksRouter.post("/:id/process-result", async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task)
      return res.status(404).json({ success: false, error: "Task not found" });

    if (task.status !== ETaskStatus.COMPLETED) {
      return res.status(409).json({
        success: false,
        error: `Task status is "${task.status}" — must be "completed" to process result`,
      });
    }

    if (!task.result) {
      return res.status(422).json({ success: false, error: "Task has no result to process" });
    }

    const payload = task.payload as Record<string, unknown> | undefined;
    const handles = Array.isArray(payload?.handles)
      ? (payload.handles as string[])
      : [];

    if (handles.length === 0) {
      return res.status(422).json({ success: false, error: "Task payload has no handles" });
    }

    const results = await processBatchCrawlResult(task.result, handles);

    log.info(`Task ${task._id}: processed result for ${results.length} KOLs`);
    res.json({ success: true, results });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});
