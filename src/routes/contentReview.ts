/** Content Review routes — manage drafts through the review flow. */
import { Router, type Request, type Response } from "express";
import { execSync } from "child_process";
import { Post, EPostStatus, CurationSource, ECurationStatus } from "../db/index.js";
import * as telegramService from "../services/telegramService.js";
import { log } from "../utils/logger.js";
import { settings } from "../config/settings.js";
import { runOpenClawAgentText } from "../services/openclawAgentService.js";
import { buildRewritePrompt } from "../prompts/index.js";
import { getActiveRoleConfig } from "../services/topicConfigService.js";

export const contentReviewRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function runOpenClaw(message: string): string {
  const escaped = message.replace(/'/g, "'\\''");
  return execSync(
    `openclaw agent --agent ${settings.openClawAgent} --message '${escaped}'`,
    { encoding: "utf-8", timeout: 300_000 },
  ).trim();
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

    if (telegramService.isConfigured()) {
      try {
        const teleMsg = await telegramService.sendDraftForReview(
          draft._id.toString(),
          draft.raw_content,
          draft.research_source || "",
        );
        draft.telegram_message_id = teleMsg.message_id;
        draft.telegram_chat_id = process.env.TELEGRAM_CHAT_ID || "";
        await draft.save();
      } catch (teleErr: any) {
        log.error(`Failed to send draft to Telegram: ${teleErr.message}`);
      }
    }

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

      if (telegramService.isConfigured() && req.body.raw_content) {
        try {
          await telegramService.sendUpdatedPreview(
            draft._id.toString(),
            draft.raw_content,
            draft.edit_history.length + 1,
            draft.telegram_chat_id,
          );
        } catch {
          /* non-critical */
        }
      }

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
 * Immediately post the draft to X via the OpenClaw browser agent,
 * verify the post was published, and mark the draft as POSTED.
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

      const xUser = settings.xUsername;
      const firstWords = draft.raw_content
        .trim()
        .split(/\s+/)
        .slice(0, 8)
        .join(" ");

      const postPrompt = `You are an AI Agent with browser access. Post this content to X (Twitter) and VERIFY it was published successfully.

BROWSER RULE: Keep ONLY ONE tab open at all times throughout ALL steps. Close any extra tabs before starting.

STEP 1 — COMPOSE & POST:
1. Close all extra tabs. Navigate to https://x.com/home in the single tab.
2. Wait until the page fully loads (tweet compose area is visible).
3. Click the post compose area and type the following content exactly:
"""
${draft.raw_content}
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

      let result: string;
      try {
        result = runOpenClaw(postPrompt);
      } catch (err: any) {
        draft.status = EPostStatus.FAILED;
        await draft.save();
        return res
          .status(500)
          .json({ success: false, error: `OpenClaw agent error: ${err.message}` });
      }

      const postUrlMatch = result.match(
        /POST_SUCCESS_VERIFIED:\s*(https?:\/\/\S+)/,
      );
      const postFailMatch = result.match(/POST_FAILED:\s*(.+)/);

      if (postUrlMatch) {
        draft.status = EPostStatus.POSTED;
        draft.post_url = postUrlMatch[1];
        await draft.save();

        if (draft.curation_source_id) {
          try {
            await CurationSource.findByIdAndUpdate(draft.curation_source_id, {
              $set: { status: ECurationStatus.USED, posted_at: new Date() },
            });
            log.info(`CurationSource ${draft.curation_source_id} marked as used`);
          } catch (csErr: any) {
            log.error(`Failed to update CurationSource status: ${csErr.message}`);
          }
        }

        return res.json({
          success: true,
          post_url: draft.post_url,
          draft,
        });
      }

      if (postFailMatch) {
        const reason = postFailMatch[1].trim();
        log.error(`Post verification failed: ${reason}`);
        draft.status = EPostStatus.FAILED;
        await draft.save();
        return res.status(500).json({
          success: false,
          error: `Post failed (verification): ${reason}`,
          draft,
        });
      }

      // Unexpected agent output — do not mark as failed, return agent output for manual check
      log.error(`OpenClaw agent returned unexpected output: ${result}`);
      return res.status(500).json({
        success: false,
        error: "Could not verify posting result. Check agent output.",
        agent_output: result.slice(0, 500),
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  },
);

/**
 * POST /drafts/:id/ai-rewrite
 * Use OpenClaw to rewrite the draft content with an optional instruction prompt.
 * Body: { prompt?: string }
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

      const userPrompt: string =
        req.body.prompt || "Rewrite this to be more punchy and engaging";
      const role = await getActiveRoleConfig();
      const aiPrompt = buildRewritePrompt(role, draft.raw_content, userPrompt);

      let rewritten: string;
      try {
        rewritten = runOpenClawAgentText(aiPrompt);
      } catch (err: any) {
        return res
          .status(500)
          .json({ success: false, error: `AI rewrite failed: ${err.message}` });
      }

      draft.edit_history.push({
        content: draft.raw_content,
        edited_at: new Date(),
        edited_by: "ai",
        prompt: userPrompt,
      });
      draft.raw_content = rewritten;
      draft.status = EPostStatus.PENDING_REVIEW;
      await draft.save();

      res.json({ success: true, draft });
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
