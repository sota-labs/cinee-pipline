/** Content Review routes — manage drafts through the Telegram review flow. */
import { Router, type Request, type Response } from "express";
import { Post, EPostStatus } from "../db/index.js";
import * as telegramService from "../services/telegramService.js";
import { log } from "../utils/logger.js";
import { execSync } from "child_process";
import * as dotenv from "dotenv";
import { settings } from "../config/settings.js";
dotenv.config();

export const contentReviewRouter = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function runOpenClaw(message: string): string {
  const escaped = message.replace(/'/g, "'\\''");
  return execSync(
    `openclaw agent --agent ${settings.openClawAgent} --message '${escaped}'`,
    {
      encoding: "utf-8",
      timeout: 300_000,
    },
  ).trim();
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

/** Create a new draft (called by the research cron job). */
contentReviewRouter.post("/drafts", async (req: Request, res: Response) => {
  try {
    const { metadata, ...rest } = req.body;
    const draft = await Post.create({
      ...rest,
      status: EPostStatus.PENDING_REVIEW,
      // Pull curation_source_id out of the metadata object the agent sends
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

/** Update draft content (manual edit from user). */
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

      if (telegramService.isConfigured()) {
        try {
          await telegramService.sendMessage(
            `✅ Draft approved! Sẽ được đăng sớm.\n\nID: ${draft._id}`,
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

      if (telegramService.isConfigured()) {
        try {
          await telegramService.sendMessage(
            `❌ Draft đã bị reject.\n\nID: ${draft._id}`,
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

      const timeStr = draft.scheduled_at.toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
      });

      if (telegramService.isConfigured()) {
        try {
          await telegramService.sendMessage(
            `⏰ Draft đã được schedule lúc ${timeStr}\n\nID: ${draft._id}`,
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

/** AI rewrite — use OpenClaw to rewrite content with optional prompt. */
contentReviewRouter.post(
  "/drafts/:id/ai-rewrite",
  async (req: Request, res: Response) => {
    try {
      const draft = await Post.findById(req.params.id);
      if (!draft)
        return res
          .status(404)
          .json({ success: false, error: "Draft not found" });

      const userPrompt =
        req.body.prompt || "Rewrite this to be more punchy and engaging";
      const aiPrompt = `You are rewriting a social media post for X (Twitter) as a tech CEO / AI filmmaker.

Current content:
"""
${draft.raw_content}
"""

Instructions: ${userPrompt}

Writing rules:
- UNDER 280 characters.
- NO generic openers: Do NOT use "AI is changing...", "The future is here...", or "Check out this...".
- Start with a Punch: Lead with a direct technical observation or a "hot take" on the production workflow.
- Language Style: Use founder slang (e.g., "RIP my VFX budget", "temporal consistency is finally usable", "vibe", "pre-viz", "POV", "latent space"). Use lowercase where it feels more natural/urgent.
- Blacklisted words: Absolutely NO: revolutionizing, game-changer, delve, unleash, testament, incredible, groundbreaking.
- Include the source reference if there was one in the original.
- End with an open question or forward-looking statement to invite engagement.
- Do NOT mention Cinee or promote any product.
- Tone: personal, direct, visionary — like a real founder's tweet, not a press release.
- Output ONLY the rewritten post, nothing else.`;

      let rewritten: string;
      try {
        rewritten = runOpenClaw(aiPrompt);
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

      if (telegramService.isConfigured()) {
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
      res.status(500).json({ success: false, error: e.message });
    }
  },
);
