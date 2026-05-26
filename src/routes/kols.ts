/** KOL Routes — API endpoints for KOL profile management */
import { Router, Request, Response } from "express";
import { KolProfile } from "../db/models/KolProfile.js";
import { KolPost } from "../db/models/KolPost.js";
import { kolCrawlerService } from "../services/kolCrawlerService.js";
import { log } from "../utils/logger.js";

const router = Router();

// ── CRUD Routes ───────────────────────────────────────────────────────────────

/**
 * GET /api/kols — List all KOLs with pagination and filters
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};

    if (req.query.is_active !== undefined) {
      filter.is_active = req.query.is_active === "true";
    }

    if (req.query.min_reputation) {
      filter.reputation_score = { $gte: parseInt(req.query.min_reputation as string) };
    }

    if (req.query.handle) {
      filter.handle = { $regex: req.query.handle as string, $options: "i" };
    }

    const [kols, total] = await Promise.all([
      KolProfile.find(filter)
        .sort({ reputation_score: -1, updated_at: -1 })
        .skip(skip)
        .limit(limit),
      KolProfile.countDocuments(filter),
    ]);

    res.json({
      data: kols,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    log.error(`[KolsRoute] List error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to list KOLs" });
  }
});

/**
 * POST /api/kols — Create a new KOL profile
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const { handle, display_name, bio, follower_count, is_verified, tier } = req.body;

    if (!handle) {
      return res.status(400).json({ error: "handle is required" });
    }

    const VALID_TIERS = ["S", "A", "B", "C"];
    if (tier && !VALID_TIERS.includes(tier)) {
      return res.status(400).json({ error: `Invalid tier. Must be one of: ${VALID_TIERS.join(", ")}` });
    }

    // Check if KOL already exists
    const existing = await KolProfile.findOne({ handle: handle.replace(/^@/, "").toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: "KOL already exists", data: existing });
    }

    const kol = await KolProfile.create({
      handle,
      display_name: display_name || "",
      bio: bio || "",
      follower_count: follower_count || 0,
      is_verified: is_verified || false,
      is_active: true,
      ...(tier ? { tier } : {}),
    });

    log.info(`[KolsRoute] Created KOL @${kol.handle}`);
    res.status(201).json({ data: kol });
  } catch (error) {
    log.error(`[KolsRoute] Create error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to create KOL" });
  }
});

/**
 * POST /api/kols/bulk-import — Import multiple KOLs
 */
router.post("/bulk-import", async (req: Request, res: Response) => {
  try {
    const { handles } = req.body;

    if (!Array.isArray(handles) || handles.length === 0) {
      return res.status(400).json({ error: "handles array is required" });
    }

    const VALID_TIERS = ["S", "A", "B", "C"];
    const results = { created: 0, existing: 0, failed: 0 };

    for (const entry of handles.slice(0, 100)) {
      try {
        // Accept both string and {handle, tier?} formats
        const handle = typeof entry === "string" ? entry : entry.handle;
        const tier = typeof entry === "object" && entry.tier ? entry.tier : undefined;

        if (tier && !VALID_TIERS.includes(tier)) {
          results.failed++;
          continue;
        }

        const normalizedHandle = handle.replace(/^@/, "").toLowerCase();
        const existing = await KolProfile.findOne({ handle: normalizedHandle });

        if (existing) {
          results.existing++;
          continue;
        }

        await KolProfile.create({
          handle: normalizedHandle,
          is_active: true,
          ...(tier ? { tier } : {}),
        });
        results.created++;
      } catch {
        results.failed++;
      }
    }

    log.info(`[KolsRoute] Bulk import: ${results.created} created, ${results.existing} existing`);
    res.json({ data: results });
  } catch (error) {
    log.error(`[KolsRoute] Bulk import error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to import KOLs" });
  }
});

/**
 * GET /api/kols/:id — Get KOL by ID
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const kol = await KolProfile.findById(req.params.id);

    if (!kol) {
      return res.status(404).json({ error: "KOL not found" });
    }

    res.json({ data: kol });
  } catch (error) {
    log.error(`[KolsRoute] Get error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to get KOL" });
  }
});

/**
 * PATCH /api/kols/:id — Update KOL profile
 */
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const updates = req.body;
    const allowedUpdates = [
      "display_name",
      "bio",
      "follower_count",
      "following_count",
      "is_verified",
      "account_age_days",
      "is_active",
      "reputation_score",
      "tier",
    ];

    const filteredUpdates: Record<string, unknown> = {};
    for (const key of allowedUpdates) {
      if (updates[key] !== undefined) {
        filteredUpdates[key] = updates[key];
      }
    }

    const kol = await KolProfile.findByIdAndUpdate(
      req.params.id,
      filteredUpdates,
      { returnDocument: 'after' },
    );

    if (!kol) {
      return res.status(404).json({ error: "KOL not found" });
    }

    log.info(`[KolsRoute] Updated KOL @${kol.handle}`);
    res.json({ data: kol });
  } catch (error) {
    log.error(`[KolsRoute] Update error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to update KOL" });
  }
});

/**
 * DELETE /api/kols/:id — Delete KOL
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const kol = await KolProfile.findByIdAndDelete(req.params.id);

    if (!kol) {
      return res.status(404).json({ error: "KOL not found" });
    }

    log.info(`[KolsRoute] Deleted KOL @${kol.handle}`);
    res.json({ message: "KOL deleted successfully" });
  } catch (error) {
    log.error(`[KolsRoute] Delete error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to delete KOL" });
  }
});

// ── Action Routes ──────────────────────────────────────────────────────────────

/**
 * POST /api/kols/:id/crawl — Trigger manual crawl
 */
router.post("/:id/crawl", async (req: Request, res: Response) => {
  try {
    const kol = await KolProfile.findById(req.params.id);
    if (!kol) {
      return res.status(404).json({ error: "KOL not found" });
    }

    const result = await kolCrawlerService.crawlKol(kol);

    res.json({
      message: "Crawl initiated",
      data: result,
    });
  } catch (error) {
    log.error(`[KolsRoute] Crawl error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to initiate crawl" });
  }
});

/**
 * GET /api/kols/:id/posts — Get posts for a KOL
 */
router.get("/:id/posts", async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    const posts = await KolPost.find({ kol_id: req.params.id })
      .sort({ posted_at: -1 })
      .skip(skip)
      .limit(limit);

    const total = await KolPost.countDocuments({ kol_id: req.params.id });

    res.json({
      data: posts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    log.error(`[KolsRoute] Posts error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to get posts" });
  }
});

export default router;
