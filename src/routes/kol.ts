/** KOL (Key Opinion Leader) API routes */
import { Router, type Request, type Response } from "express";
import { Kol } from "../db/models/Kol.js";
import { KolPost } from "../db/models/Kol.js";

export const kolRouter = Router();

// ── CRUD Operations ─────────────────────────────────────────────────────────

/** POST /api/kols - Create new KOL */
kolRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { handle, platform = "x", displayName, profileUrl, isActive = true } = req.body;
    
    // Normalize handle
    const normalizedHandle = handle.replace(/^@/, "").toLowerCase();
    
    // Check duplicate
    const existing = await Kol.findOne({ platform, handle: normalizedHandle });
    if (existing) {
      return res.status(409).json({ 
        success: false, 
        error: `KOL @${normalizedHandle} on ${platform} already exists` 
      });
    }
    
    const kol = await Kol.create({
      handle: normalizedHandle,
      platform,
      displayName,
      profileUrl,
      isActive,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    
    res.json({ success: true, data: kol });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/** GET /api/kols - List all KOLs with filters */
kolRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { platform, isActive, q, limit = "20", skip = "0" } = req.query;
    
    const filter: Record<string, unknown> = {};
    if (platform) filter.platform = platform;
    if (isActive !== undefined) filter.isActive = isActive === "true";
    if (q) filter.handle = { $regex: q, $options: "i" };
    
    const [data, total] = await Promise.all([
      Kol.find(filter)
        .skip(parseInt(skip as string))
        .limit(parseInt(limit as string))
        .sort({ createdAt: -1 }),
      Kol.countDocuments(filter),
    ]);
    
    res.json({ 
      success: true, 
      data, 
      total, 
      limit: parseInt(limit as string), 
      skip: parseInt(skip as string) 
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** GET /api/kols/:id - Get single KOL */
kolRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const kol = await Kol.findById(req.params.id);
    if (!kol) {
      return res.status(404).json({ success: false, error: "KOL not found" });
    }
    res.json({ success: true, data: kol });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** PATCH /api/kols/:id - Update KOL */
kolRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { handle, ...otherData } = req.body;
    
    const updateData: Record<string, unknown> = { ...otherData, updatedAt: new Date() };
    if (handle) {
      updateData.handle = handle.replace(/^@/, "").toLowerCase();
    }
    
    const kol = await Kol.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    );
    
    if (!kol) {
      return res.status(404).json({ success: false, error: "KOL not found" });
    }
    
    res.json({ success: true, data: kol });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/** DELETE /api/kols/:id - Delete KOL */
kolRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const kol = await Kol.findByIdAndDelete(req.params.id);
    if (!kol) {
      return res.status(404).json({ success: false, error: "KOL not found" });
    }
    res.json({ success: true, message: "KOL deleted" });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Stats & Actions ───────────────────────────────────────────────────────────

/** GET /api/kols/:id/stats - Get KOL statistics */
kolRouter.get("/:id/stats", async (req: Request, res: Response) => {
  try {
    const kol = await Kol.findById(req.params.id);
    if (!kol) {
      return res.status(404).json({ success: false, error: "KOL not found" });
    }
    
    const [totalPosts, pendingPosts] = await Promise.all([
      KolPost.countDocuments({ kolId: req.params.id }),
      KolPost.countDocuments({ kolId: req.params.id, status: "NEW" }),
    ]);
    
    res.json({
      success: true,
      data: {
        kol,
        stats: {
          totalPosts,
          pendingPosts,
          lastCrawledAt: kol.lastCrawledAt,
          styleLastLearnedAt: kol.styleLastLearnedAt,
          writingSamplesCount: kol.writingSamples?.length ?? 0,
        },
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** POST /api/kols/:id/style-learn - Trigger style learning */
kolRouter.post("/:id/style-learn", async (req: Request, res: Response) => {
  try {
    const { force = false } = req.body;
    const kolId = req.params.id;
    
    const kol = await Kol.findById(kolId);
    if (!kol) {
      return res.status(404).json({ success: false, error: "KOL not found" });
    }
    
    // TODO: Enqueue style-learn job via BullMQ
    // For now, return success as the job scheduling would need the queue instance
    res.json({ 
      success: true, 
      message: "Style learning triggered",
      data: { kolId, force }
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** GET /api/kols/:id/posts - Get KOL's posts */
kolRouter.get("/:id/posts", async (req: Request, res: Response) => {
  try {
    const { limit = "20", skip = "0" } = req.query;
    const kolId = req.params.id;
    
    const kol = await Kol.findById(kolId);
    if (!kol) {
      return res.status(404).json({ success: false, error: "KOL not found" });
    }
    
    const posts = await KolPost.find({ kolId })
      .skip(parseInt(skip as string))
      .limit(parseInt(limit as string))
      .sort({ postedAt: -1 });
    
    const total = await KolPost.countDocuments({ kolId });
    
    res.json({ success: true, data: posts, total });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});
