/** Topic config routes — CRUD and activation for runtime topic switching. */
import { Router, Request, Response } from "express";
import {
  listTopicConfigs,
  getTopicConfigById,
  createTopicConfig,
  updateTopicConfig,
  deleteTopicConfig,
  activateTopicConfig,
  deactivateAll,
  getActiveRoleConfig,
} from "../services/topicConfigService.js";
import { registerIsolatedJobs, removeAllJobs } from "../services/schedulerService.js";
import { log } from "../utils/logger.js";

export const topicConfigRouter = Router();

/** GET /api/topic-config — list all topic configs. */
topicConfigRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const configs = await listTopicConfigs();
    res.json({ success: true, data: configs });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/** GET /api/topic-config/active — get currently active config (or settings default). */
topicConfigRouter.get("/active", async (_req: Request, res: Response) => {
  try {
    const role = await getActiveRoleConfig();
    res.json({ success: true, data: role });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/** GET /api/topic-config/:id — get a single config by ID. */
topicConfigRouter.get("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const config = await getTopicConfigById(req.params.id);
    if (!config) {
      return res.status(404).json({ success: false, error: "Topic config not found" });
    }
    res.json({ success: true, data: config });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/** POST /api/topic-config — create a new topic config. */
topicConfigRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { name, brand, persona, tone } = req.body as Record<string, unknown>;
    if (!name || !brand || !persona || !tone) {
      return res.status(400).json({
        success: false,
        error: "Required fields: name, brand, persona, tone",
      });
    }
    const config = await createTopicConfig(req.body);
    res.status(201).json({ success: true, data: config });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/** PATCH /api/topic-config/:id — partial update. */
topicConfigRouter.patch("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const updated = await updateTopicConfig(req.params.id, req.body);
    if (!updated) {
      return res.status(404).json({ success: false, error: "Topic config not found" });
    }
    res.json({ success: true, data: updated });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/** DELETE /api/topic-config/:id — remove a config. */
topicConfigRouter.delete("/:id", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const deleted = await deleteTopicConfig(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Topic config not found" });
    }
    res.json({ success: true, message: "Topic config deleted" });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/** POST /api/topic-config/:id/activate — set as active, re-registers cron jobs. */
topicConfigRouter.post("/:id/activate", async (req: Request<{ id: string }>, res: Response) => {
  try {
    const activated = await activateTopicConfig(req.params.id);
    if (!activated) {
      return res.status(404).json({ success: false, error: "Topic config not found" });
    }

    // Re-register all cron jobs with new topic prompts
    let cronResults: Record<string, unknown>[] = [];
    try {
      await removeAllJobs();
      cronResults = await registerIsolatedJobs();
    } catch (cronErr) {
      log.error(`[topicConfig] Cron re-registration failed after activate: ${(cronErr as Error).message}`);
    }

    res.json({
      success: true,
      data: activated,
      message: "Topic config activated. Cron jobs re-registered with new prompts.",
      cron_results: cronResults,
    });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/** POST /api/topic-config/deactivate-all — revert to settings.ts default, re-registers cron jobs. */
topicConfigRouter.post("/deactivate-all", async (_req: Request, res: Response) => {
  try {
    await deactivateAll();

    // Re-register all cron jobs using the settings.ts default persona
    let cronResults: Record<string, unknown>[] = [];
    try {
      await removeAllJobs();
      cronResults = await registerIsolatedJobs();
    } catch (cronErr) {
      log.error(`[topicConfig] Cron re-registration failed after deactivate-all: ${(cronErr as Error).message}`);
    }

    res.json({
      success: true,
      message: "All topic configs deactivated. Using settings.ts default. Cron jobs re-registered.",
      cron_results: cronResults,
    });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});
