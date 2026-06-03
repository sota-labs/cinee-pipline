/** ReplyEval — read-only aggregate stats for KPI measurement */
import { Router, type Request, type Response } from "express";
import { ReplyEvalLog } from "../db/models/ReplyEvalLog.js";

export const replyEvalRouter = Router();

replyEvalRouter.get("/stats", async (req: Request, res: Response) => {
  try {
    const days = Math.max(
      1,
      Math.min(90, parseInt((req.query.days as string) ?? "7", 10)),
    );
    const since = new Date(Date.now() - days * 86_400_000);
    const logs = await ReplyEvalLog.find({
      created_at: { $gte: since },
    }).lean();

    if (logs.length === 0) {
      return res.json({ days, total: 0 });
    }

    const total = logs.length;
    const decided = logs.filter((l) => l.admin_decision);
    const edited = decided.filter((l) => l.admin_decision === "edited");
    const approved = decided.filter(
      (l) =>
        l.admin_decision === "approved" || l.admin_decision === "auto_afk",
    );
    const rejected = decided.filter((l) => l.admin_decision === "rejected");
    const withBlacklistHits = logs.filter(
      (l) => l.blacklisted_words_found.length > 0,
    );
    const avgEditRatio =
      edited.length > 0
        ? edited.reduce((s, l) => s + (l.edit_ratio ?? 0), 0) / edited.length
        : null;

    res.json({
      days,
      total,
      decided: decided.length,
      approved_count: approved.length,
      edited_count: edited.length,
      rejected_count: rejected.length,
      approval_rate: decided.length > 0 ? approved.length / decided.length : null,
      edit_rate: decided.length > 0 ? edited.length / decided.length : null,
      avg_edit_ratio: avgEditRatio,
      blacklist_violation_rate:
        total > 0 ? withBlacklistHits.length / total : null,
    });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

replyEvalRouter.get("/recent", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(
      100,
      parseInt((req.query.limit as string) ?? "20", 10),
    );
    const logs = await ReplyEvalLog.find().sort({ created_at: -1 }).limit(limit);
    res.json({ success: true, logs });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});