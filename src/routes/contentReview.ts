/** Content Review routes — manage drafts through the review flow. */
import { Router, type Request, type Response } from "express";
import {
  Post,
  EPostStatus,
  Task,
  ETaskType,
} from "../db/index.js";
import { log } from "../utils/logger.js";
import { settings } from "../config/settings.js";
import { buildRewritePrompt } from "../prompts/index.js";
import { getActiveRoleConfig } from "../services/topicConfigService.js";

export const contentReviewRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build the full OpenClaw browser prompt for posting a draft to X. */
function buildPostNowPrompt(rawContent: string, xUser: string): string {
  const firstWords = rawContent.trim().split(/\s+/).slice(0, 8).join(" ");
  return `You are an AI Agent with browser access. Post this content to X (Twitter) and VERIFY it was published successfully.

BROWSER RULE: Keep ONLY ONE tab open at all times throughout ALL steps. Close any extra tabs before starting.

STEP 1 — COMPOSE & POST:
1. Close all extra tabs. Navigate to https://x.com/home in the single tab.
2. Wait until the page fully loads (tweet compose area is visible).
3. Click the post compose area and type the following content exactly:
"""
${rawContent}
"""
4. Click the "Post" button ([data-testid="tweetButtonInline"]).
5. Wait 5 seconds. If an error banner appears (e.g. "Something went wrong"), report POST_FAILED: error banner shown and stop.

STEP 2 — VERIFY BY CLICKING INTO THE POST:
6. In the SAME tab, navigate to https://x.com/${xUser}
7. Wait until the profile page fully loads and the first tweet article is visible.
8. Click on the FIRST <article> (the most recent tweet) to open its detail page — do NOT open in new tab.
9. Wait until the post detail page fully loads.
10. Take a browser.snapshot and verify:
    CHECK A (Content): The post text on this detail page must START WITH or CONTAIN: "${firstWords}"
    CHECK B (Time): The <time> element must show a timestamp within the last 3 minutes.
11. If BOTH checks pass:
    - Read the current browser URL (it should match /${xUser}/status/<id>).
    - Report on its own line: POST_SUCCESS_VERIFIED: <current_browser_url>
12. If EITHER check fails:
    - Report on its own line: POST_FAILED: <reason>`;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/** Create a new draft (called by the research cron job). */
contentReviewRouter.post("/drafts", async (req: Request, res: Response) => {
  try {
    const { metadata, ...rest } = req.body;
    const draft = await Post.create({
      ...rest,
      status: EPostStatus.PENDING_REVIEW,
      curation_source_id: metadata?.curation_source_id ?? null,
    });

    res.json({ success: true, id: draft._id, draft });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/** List drafts with optional status filter. */
contentReviewRouter.get("/drafts", async (req: Request, res: Response) => {
  try {
    const { status, limit = "20", skip = "0" } = req.query;
    const filter: Record<string, unknown> = {};

    if (status) {
      const statuses = (status as string)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
    }

    const [drafts, total] = await Promise.all([
      Post.find(filter)
        .sort({ created_at: -1 })
        .skip(parseInt(skip as string))
        .limit(parseInt(limit as string)),
      Post.countDocuments(filter),
    ]);

    res.json({ success: true, drafts, total });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Get single draft. */
contentReviewRouter.get("/drafts/:id", async (req: Request, res: Response) => {
  try {
    const draft = await Post.findById(req.params.id);
    if (!draft)
      return res.status(404).json({ success: false, error: "Draft not found" });
    res.json({ success: true, draft });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Update draft content (manual edit). */
contentReviewRouter.patch(
  "/drafts/:id",
  async (req: Request, res: Response) => {
    try {
      const draft = await Post.findById(req.params.id);
      if (!draft)
        return res
          .status(404)
          .json({ success: false, error: "Draft not found" });

      const oldContent = draft.raw_content;

      if (req.body.raw_content) {
        draft.raw_content = req.body.raw_content;
        draft.edit_history.push({
          content: oldContent,
          edited_at: new Date(),
          edited_by: "user",
        });
      }
      if (req.body.scheduled_at)
        draft.scheduled_at = new Date(req.body.scheduled_at);
      draft.status = req.body.status || EPostStatus.EDITING;

      await draft.save();
      res.json({ success: true, draft });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e.message });
    }
  },
);

/** Approve a draft. */
contentReviewRouter.patch(
  "/drafts/:id/approve",
  async (req: Request, res: Response) => {
    try {
      const draft = await Post.findById(req.params.id);
      if (!draft)
        return res
          .status(404)
          .json({ success: false, error: "Draft not found" });

      draft.status = EPostStatus.APPROVED;
      await draft.save();
      res.json({ success: true, draft });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e.message });
    }
  },
);

/** Reject a draft. */
contentReviewRouter.patch(
  "/drafts/:id/reject",
  async (req: Request, res: Response) => {
    try {
      const draft = await Post.findById(req.params.id);
      if (!draft)
        return res
          .status(404)
          .json({ success: false, error: "Draft not found" });

      draft.status = EPostStatus.REJECTED;
      await draft.save();
      res.json({ success: true, draft });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e.message });
    }
  },
);

/** Schedule a draft for a specific time. */
contentReviewRouter.patch(
  "/drafts/:id/schedule",
  async (req: Request, res: Response) => {
    try {
      const draft = await Post.findById(req.params.id);
      if (!draft)
        return res
          .status(404)
          .json({ success: false, error: "Draft not found" });

      if (!req.body.scheduled_at) {
        return res
          .status(400)
          .json({ success: false, error: "scheduled_at is required" });
      }

      draft.status = EPostStatus.SCHEDULED;
      draft.scheduled_at = new Date(req.body.scheduled_at);
      await draft.save();
      res.json({ success: true, draft });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e.message });
    }
  },
);

/**
 * POST /drafts/:id/post-now
 * Creates a task to post the draft to X via OpenClaw.
 * Returns immediately with task_id — the worker executes asynchronously.
 */
contentReviewRouter.post(
  "/drafts/:id/post-now",
  async (req: Request, res: Response) => {
    try {
      const draft = await Post.findById(req.params.id);
      if (!draft)
        return res
          .status(404)
          .json({ success: false, error: "Draft not found" });

      if (draft.status === EPostStatus.POSTED) {
        return res.status(409).json({
          success: false,
          error: "This draft has already been posted",
          post_url: draft.post_url,
        });
      }

      const prompt = buildPostNowPrompt(draft.raw_content, settings.xUsername);

      const task = await Task.create({
        type: ETaskType.POST_NOW,
        agent: settings.openClawAgent,
        prompt,
        ref_id: draft._id.toString(),
        ref_collection: "posts",
        payload: {
          draft_id: draft._id.toString(),
          raw_content: draft.raw_content,
          curation_source_id: draft.curation_source_id ?? null,
        },
      });

      log.info(`Task created: ${task._id} (post_now) for draft ${draft._id}`);
      res.status(202).json({ success: true, task_id: task._id, task });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
);

/**
 * POST /drafts/:id/ai-rewrite
 * Creates a task to rewrite the draft content with AI.
 * Body: { prompt?: string }
 * Returns immediately with task_id — the worker executes asynchronously.
 */
contentReviewRouter.post(
  "/drafts/:id/ai-rewrite",
  async (req: Request, res: Response) => {
    try {
      const draft = await Post.findById(req.params.id);
      if (!draft)
        return res
          .status(404)
          .json({ success: false, error: "Draft not found" });

      const userInstruction: string =
        req.body.prompt || "Rewrite this to be more punchy and engaging";
      const role = await getActiveRoleConfig();
      const prompt = buildRewritePrompt(role, draft.raw_content, userInstruction);

      const task = await Task.create({
        type: ETaskType.AI_REWRITE,
        agent: settings.openClawAgent,
        prompt,
        ref_id: draft._id.toString(),
        ref_collection: "posts",
        payload: {
          draft_id: draft._id.toString(),
          user_instruction: userInstruction,
          original_content: draft.raw_content,
        },
      });

      log.info(`Task created: ${task._id} (ai_rewrite) for draft ${draft._id}`);
      res.status(202).json({ success: true, task_id: task._id, task });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
);

/**
 * POST /drafts/:id/edit
 * Manually replace draft content and reset status to PENDING_REVIEW.
 * Body: { content: string }
 */
contentReviewRouter.post(
  "/drafts/:id/edit",
  async (req: Request, res: Response) => {
    try {
      const draft = await Post.findById(req.params.id);
      if (!draft)
        return res
          .status(404)
          .json({ success: false, error: "Draft not found" });

      const { content } = req.body;
      if (!content || typeof content !== "string" || !content.trim()) {
        return res
          .status(400)
          .json({ success: false, error: "content is required" });
      }

      draft.edit_history.push({
        content: draft.raw_content,
        edited_at: new Date(),
        edited_by: "user",
      });
      draft.raw_content = content.trim();
      draft.status = EPostStatus.PENDING_REVIEW;
      await draft.save();

      res.json({ success: true, draft });
    } catch (e: any) {
      res.status(400).json({ success: false, error: e.message });
    }
  },
);
