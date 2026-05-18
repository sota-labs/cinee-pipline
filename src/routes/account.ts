/** Account personality routes — view and manage own account personality profile */
import { Router, type Request, type Response } from "express";
import { ownAccountService } from "../services/ownAccountService.js";
import { ownAccountCrawlerService } from "../services/ownAccountCrawlerService.js";
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

/**
 * POST /api/account/posts/seed
 * Queue a crawl task to seed own account posts into DB for AI learning.
 * Body: { daysBack?: number, limit?: number }
 */
accountRouter.post("/posts/seed", async (req: Request, res: Response) => {
  try {
    const { daysBack = 30, limit = 100 } = req.body as {
      daysBack?: number;
      limit?: number;
    };

    const taskId = await ownAccountCrawlerService.queueCrawlTask({ daysBack, limit });

    if (!taskId) {
      return res.status(422).json({
        success: false,
        error: "Failed to queue crawl task — check X_USERNAME env var",
      });
    }

    const existing = await ownAccountCrawlerService.countSeedPosts();
    res.json({ success: true, taskId, existingPostCount: existing });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/**
 * POST /api/account/posts/seed/result
 * Process crawl result from cinee-worker and seed posts into DB.
 * Body: { result: string, limit?: number }
 */
accountRouter.post("/posts/seed/result", async (req: Request, res: Response) => {
  try {
    const { result, limit = 100 } = req.body as {
      result: string;
      limit?: number;
    };

    if (!result || typeof result !== "string") {
      return res.status(400).json({ success: false, error: "result string is required" });
    }

    const crawlResult = await ownAccountCrawlerService.processCrawlResult(result, limit);
    res.json({ success: true, data: crawlResult });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/**
 * GET /api/account/posts/seed/count
 * Returns count of seeded own-account posts available for learning.
 */
accountRouter.get("/posts/seed/count", async (_req: Request, res: Response) => {
  try {
    const count = await ownAccountCrawlerService.countSeedPosts();
    res.json({ success: true, count });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});
