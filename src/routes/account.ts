/** Account personality routes — view and manage own account personality profile */
import { Router, type Request, type Response } from "express";
import { ownAccountService } from "../services/ownAccountService.js";
import type { IOwnAccountManualConfig } from "../db/models/OwnAccountProfile.js";

export const accountRouter = Router();

/**
 * GET /api/account/personality
 * Returns the current effective personality profile.
 */
accountRouter.get("/personality", async (_req: Request, res: Response) => {
  try {
    const profile = await ownAccountService.getProfile();
    res.json({
      success: true,
      data: {
        manual_config: profile.manual_config,
        learned_profile: profile.learned_profile,
        effective_profile: profile.effective_profile,
        learning_confidence: profile.learned_profile.learning_confidence,
        last_learned_at: profile.learned_profile.last_learned_at,
        posts_analyzed: profile.learned_profile.posts_analyzed,
      },
    });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/**
 * PATCH /api/account/personality/manual
 * Update the manual config baseline.
 * Body: Partial<IOwnAccountManualConfig>
 */
accountRouter.patch("/personality/manual", async (req: Request, res: Response) => {
  try {
    const update = req.body as Partial<IOwnAccountManualConfig>;

    if (!update || typeof update !== "object") {
      return res.status(400).json({ success: false, error: "Invalid request body" });
    }

    const profile = await ownAccountService.updateManualConfig(update);
    res.json({
      success: true,
      data: {
        manual_config: profile.manual_config,
        effective_profile: profile.effective_profile,
      },
    });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/**
 * POST /api/account/personality/learn
 * Manually trigger personality learning from own post history.
 */
accountRouter.post("/personality/learn", async (_req: Request, res: Response) => {
  try {
    const taskId = await ownAccountService.learnPersonality();

    if (!taskId) {
      return res.status(422).json({
        success: false,
        error: "Not enough posts to learn from (minimum 10 posts required in last 30 days)",
      });
    }

    res.json({ success: true, taskId });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});
