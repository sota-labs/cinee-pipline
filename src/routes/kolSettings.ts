/** KolSettings Routes — API endpoints for global KOL engagement configuration */
import { Router, Request, Response } from "express";
import { KolSettings } from "../db/models/KolSettings.js";
import { EReplyMode } from "../db/models/KolReplySuggestion.js";
import { log } from "../utils/logger.js";

const router = Router();

// ── Settings CRUD ─────────────────────────────────────────────────────────────

/**
 * GET /api/kol-settings — Get current global settings
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const settings = await KolSettings.getSettings();

    res.json({
      data: {
        default_mode: settings.default_mode,
        crawl_interval_minutes: settings.crawl_interval_minutes,
        max_posts_per_crawl: settings.max_posts_per_crawl,
        max_comments_per_post: settings.max_comments_per_post,
        afk: settings.afk,
        manual: settings.manual,
        self_reply: settings.self_reply,
        safety: settings.safety,
        tier_crawl_intervals: settings.tier_crawl_intervals,
        updated_at: settings.updated_at,
      },
    });
  } catch (error) {
    log.error(`[KolSettingsRoute] Get error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to get settings" });
  }
});

/**
 * GET /api/kol-settings/mode — Get current mode only
 */
router.get("/mode", async (_req: Request, res: Response) => {
  try {
    const settings = await KolSettings.getSettings();

    res.json({
      data: {
        mode: settings.default_mode,
        is_afk: settings.default_mode === EReplyMode.AFK,
        is_manual: settings.default_mode === EReplyMode.MANUAL,
      },
    });
  } catch (error) {
    log.error(`[KolSettingsRoute] Get mode error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to get mode" });
  }
});

/**
 * POST /api/kol-settings/mode — Switch between AFK and Manual mode
 */
router.post("/mode", async (req: Request, res: Response) => {
  try {
    const { mode } = req.body;

    if (!mode || ![EReplyMode.AFK, EReplyMode.MANUAL].includes(mode)) {
      return res.status(400).json({
        error: "Invalid mode. Use 'afk' or 'manual'",
        valid_modes: [EReplyMode.AFK, EReplyMode.MANUAL],
      });
    }

    const settings = await KolSettings.getSettings();
    const oldMode = settings.default_mode;
    settings.default_mode = mode;
    await settings.save();

    log.info(`[KolSettingsRoute] Mode switched: ${oldMode} → ${mode}`);

    res.json({
      message: `Mode switched to ${mode}`,
      data: {
        previous_mode: oldMode,
        current_mode: mode,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    log.error(`[KolSettingsRoute] Switch mode error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to switch mode" });
  }
});

/**
 * PATCH /api/kol-settings — Update settings
 */
router.patch("/", async (req: Request, res: Response) => {
  try {
    const updates = req.body;
    const settings = await KolSettings.getSettings();

    // Update allowed fields
    const allowedTopLevel = [
      "default_mode",
      "crawl_interval_minutes",
      "max_posts_per_crawl",
      "max_comments_per_post",
    ];

    for (const key of allowedTopLevel) {
      if (updates[key] !== undefined) {
        (settings as unknown as Record<string, unknown>)[key] = updates[key];
      }
    }

    // Update nested AFK settings
    if (updates.afk) {
      const afkFields = [
        "min_confidence_threshold",
        "auto_delay_min_minutes",
        "auto_delay_max_minutes",
        "hourly_reply_limit",
        "daily_reply_limit",
      ];
      for (const key of afkFields) {
        if (updates.afk[key] !== undefined) {
          (settings.afk as unknown as Record<string, unknown>)[key] = updates.afk[key];
        }
      }
    }

    // Update nested Manual settings
    if (updates.manual) {
      const manualFields = ["notification_channel", "max_pending_hours"];
      for (const key of manualFields) {
        if (updates.manual[key] !== undefined) {
          (settings.manual as unknown as Record<string, unknown>)[key] = updates.manual[key];
        }
      }
    }

    // Update nested Safety settings
    if (updates.safety) {
      const safetyFields = [
        "min_kol_trust_score",
        "enable_duplicate_detection",
        "enable_banned_words_filter",
        "max_hourly_replies_global",
      ];
      for (const key of safetyFields) {
        if (updates.safety[key] !== undefined) {
          (settings.safety as unknown as Record<string, unknown>)[key] = updates.safety[key];
        }
      }
    }

    // Update nested Self-Reply settings
    if (updates.self_reply) {
      const selfReplyFields = [
        "enabled",
        "min_comments_to_trigger",
        "reply_interval_seconds",
        "hourly_limit",
      ];
      for (const key of selfReplyFields) {
        if (updates.self_reply[key] !== undefined) {
          (settings.self_reply as unknown as Record<string, unknown>)[key] = updates.self_reply[key];
        }
      }
    }

    // Update nested Tier Crawl Intervals
    if (updates.tier_crawl_intervals) {
      const tci = updates.tier_crawl_intervals;
      const clamp = (val: unknown, min: number): number | null => {
        const n = Number(val);
        return isNaN(n) ? null : Math.max(min, n);
      };
      if (tci.S !== undefined) {
        const v = clamp(tci.S, 5);
        if (v === null) return res.status(400).json({ error: "tier_crawl_intervals.S must be a number" });
        settings.tier_crawl_intervals.S = v;
      }
      if (tci.A !== undefined) {
        const v = clamp(tci.A, 30);
        if (v === null) return res.status(400).json({ error: "tier_crawl_intervals.A must be a number" });
        settings.tier_crawl_intervals.A = v;
      }
      if (tci.B !== undefined) {
        const v = clamp(tci.B, 60);
        if (v === null) return res.status(400).json({ error: "tier_crawl_intervals.B must be a number" });
        settings.tier_crawl_intervals.B = v;
      }
      if (tci.C !== undefined) {
        const v = clamp(tci.C, 60);
        if (v === null) return res.status(400).json({ error: "tier_crawl_intervals.C must be a number" });
        settings.tier_crawl_intervals.C = v;
      }
    }

    await settings.save();

    log.info("[KolSettingsRoute] Settings updated");

    res.json({
      message: "Settings updated",
      data: {
        default_mode: settings.default_mode,
        afk: settings.afk,
        manual: settings.manual,
        safety: settings.safety,
        self_reply: settings.self_reply,
        tier_crawl_intervals: settings.tier_crawl_intervals,
        updated_at: settings.updated_at,
      },
    });
  } catch (error) {
    log.error(`[KolSettingsRoute] Update error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// ── Quick Toggle Endpoints ───────────────────────────────────────────────────

/**
 * POST /api/kol-settings/mode/afk — Quick switch to AFK mode
 */
router.post("/mode/afk", async (_req: Request, res: Response) => {
  try {
    const settings = await KolSettings.getSettings();
    const oldMode = settings.default_mode;
    settings.default_mode = EReplyMode.AFK;
    await settings.save();

    log.info(`[KolSettingsRoute] Mode switched: ${oldMode} → afk`);

    res.json({
      message: "Switched to AFK mode",
      data: {
        previous_mode: oldMode,
        current_mode: EReplyMode.AFK,
        description: "Replies will be sent automatically based on confidence threshold",
      },
    });
  } catch (error) {
    log.error(`[KolSettingsRoute] Switch to AFK error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to switch mode" });
  }
});

/**
 * POST /api/kol-settings/mode/manual — Quick switch to Manual mode
 */
router.post("/mode/manual", async (_req: Request, res: Response) => {
  try {
    const settings = await KolSettings.getSettings();
    const oldMode = settings.default_mode;
    settings.default_mode = EReplyMode.MANUAL;
    await settings.save();

    log.info(`[KolSettingsRoute] Mode switched: ${oldMode} → manual`);

    res.json({
      message: "Switched to Manual mode",
      data: {
        previous_mode: oldMode,
        current_mode: EReplyMode.MANUAL,
        description: "All suggestions require admin approval via Telegram",
      },
    });
  } catch (error) {
    log.error(`[KolSettingsRoute] Switch to Manual error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to switch mode" });
  }
});

// ── Threshold Endpoints ──────────────────────────────────────────────────────

/**
 * GET /api/kol-settings/thresholds — Get current thresholds
 */
router.get("/thresholds", async (_req: Request, res: Response) => {
  try {
    const settings = await KolSettings.getSettings();

    res.json({
      data: {
        afk: {
          min_confidence_threshold: settings.afk.min_confidence_threshold,
          auto_delay_min_minutes: settings.afk.auto_delay_min_minutes,
          auto_delay_max_minutes: settings.afk.auto_delay_max_minutes,
          hourly_reply_limit: settings.afk.hourly_reply_limit,
          daily_reply_limit: settings.afk.daily_reply_limit,
        },
        safety: {
          min_kol_trust_score: settings.safety.min_kol_trust_score,
          max_hourly_replies_global: settings.safety.max_hourly_replies_global,
        },
      },
    });
  } catch (error) {
    log.error(`[KolSettingsRoute] Get thresholds error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to get thresholds" });
  }
});

/**
 * PATCH /api/kol-settings/thresholds — Update AFK thresholds
 */
router.patch("/thresholds", async (req: Request, res: Response) => {
  try {
    const { min_confidence, delay_min, delay_max, hourly_limit, daily_limit } = req.body;
    const settings = await KolSettings.getSettings();

    if (min_confidence !== undefined) {
      settings.afk.min_confidence_threshold = Math.max(0, Math.min(100, min_confidence));
    }
    if (delay_min !== undefined) {
      settings.afk.auto_delay_min_minutes = Math.max(1, delay_min);
    }
    if (delay_max !== undefined) {
      settings.afk.auto_delay_max_minutes = Math.max(settings.afk.auto_delay_min_minutes, delay_max);
    }
    if (hourly_limit !== undefined) {
      settings.afk.hourly_reply_limit = Math.max(1, hourly_limit);
    }
    if (daily_limit !== undefined) {
      settings.afk.daily_reply_limit = Math.max(1, daily_limit);
    }

    await settings.save();

    res.json({
      message: "Thresholds updated",
      data: settings.afk,
    });
  } catch (error) {
    log.error(`[KolSettingsRoute] Update thresholds error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to update thresholds" });
  }
});

export default router;
