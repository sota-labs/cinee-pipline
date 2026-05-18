/** Tool API routes — Python CrewAI agents call these endpoints.
 *
 * Collections:
 *   /db/posts    — CEO's own posts
 *   /db/replies  — CEO's replies (status: draft | rejected | resolved | replied)
 */
import { Router, type Request, type Response } from "express";
import { Post, Reply, PersonaKnowledge, CurationSource, Interaction, SelfReplyQueue } from "../db/index.js";
import { EReplyStatus } from "../db/models/Reply.js";
import { ECurationStatus } from "../db/models/CurationSource.js";
import { selfReplyService } from "../services/selfReplyService.js";
import { log } from "../utils/logger.js";

export const toolsRouter = Router();

function parseXUrl(url: string): { handle: string; tweetId: string } | null {
  const match = url?.match(/x\.com\/([^/]+)\/status\/(\d+)/);
  if (!match) return null;
  return { handle: match[1], tweetId: match[2] };
}

// ── DB: Posts ─────────────────────────────────────────────────────────────────

toolsRouter.post("/db/posts", async (req: Request, res: Response) => {
  try {
    const post = await Post.create(req.body);
    res.json({ success: true, id: post._id, post });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

toolsRouter.get("/db/posts", async (req: Request, res: Response) => {
  try {
    const { status, content_type, platform, limit = "20", skip = "0" } = req.query;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (content_type) filter.content_type = content_type;
    if (platform) filter.platform = platform;

    const posts = await Post.find(filter)
      .sort({ created_at: -1 })
      .skip(parseInt(skip as string))
      .limit(parseInt(limit as string));

    res.json({ success: true, posts, total: posts.length });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

toolsRouter.get("/db/posts/:id", async (req: Request, res: Response) => {
  try {
    const post = await Post.findById(req.params.id as string);
    if (!post) return res.status(404).json({ success: false, error: "Post not found" });
    res.json({ success: true, post });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

toolsRouter.patch("/db/posts/:id", async (req: Request, res: Response) => {
  try {
    const post = await Post.findByIdAndUpdate(
      req.params.id as string,
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!post) return res.status(404).json({ success: false, error: "Post not found" });
    res.json({ success: true, post });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

toolsRouter.get("/db/posts/duplicate-check", async (req: Request, res: Response) => {
  try {
    const { content, hours = "48" } = req.query;
    const since = new Date(Date.now() - parseInt(hours as string) * 3_600_000);
    const exists = await Post.exists({ raw_content: content, created_at: { $gte: since } });
    res.json({ is_duplicate: !!exists });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DB: Replies ───────────────────────────────────────────────────────────────

/** Create a reply (default status: resolved) */
toolsRouter.post("/db/replies", async (req: Request, res: Response) => {
  try {
    const items = (Array.isArray(req.body) ? req.body : [req.body]).map((item) => ({
      ...item,
      status: "resolved",
    }));
    const replies = await Reply.insertMany(items, { ordered: false });

    // Trigger self-reply queue creation for resolved mentions with parent_post_url
    setImmediate(async () => {
      for (const reply of replies) {
        if (reply.status !== EReplyStatus.RESOLVED || !reply.parent_post_url) continue;

        const parsed = parseXUrl(reply.url ?? "");
        if (!parsed) continue;

        try {
          const post = await Post.findOne({ post_url: reply.parent_post_url });
          if (!post) continue;

          const comment = {
            comment_id: parsed.tweetId,
            author_handle: reply.author_handle || parsed.handle,
            content: reply.reply_content,
            likes: 0,
          };

          const existing = await SelfReplyQueue.findOne({ our_post_id: post._id });
          if (existing) {
            await selfReplyService.addCommentToQueue(String(existing._id), comment);
          } else {
            await selfReplyService.createReplyQueue(String(post._id), reply.parent_post_url, [comment]);
          }
        } catch (e: unknown) {
          log.error(`[Tools] Self-reply trigger failed for reply ${reply._id}: ${(e as Error).message}`);
        }
      }
    });

    res.json({ success: true, inserted: replies.length, replies });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/** List replies
 *
 * Query params:
 *   status   — single value or comma-separated list: draft,resolved,replied,rejected
 *   platform — x | reddit
 *   limit    — default 20
 *   skip     — default 0
 *
 * Examples:
 *   GET /api/tools/db/replies?status=draft
 *   GET /api/tools/db/replies?status=draft,resolved
 *   GET /api/tools/db/replies?status=replied&platform=x
 */
toolsRouter.get("/db/replies", async (req: Request, res: Response) => {
  try {
    const { status = "resolved", platform = "x", limit = "20", skip = "0" } = req.query;
    const filter: Record<string, unknown> = {};

    if (status) {
      const statuses = (status as string).split(",").map((s) => s.trim()).filter(Boolean);
      filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
    }

    if (platform) filter.platform = platform;

    const [replies, total] = await Promise.all([
      Reply.find(filter)
        .sort({ created_at: -1 })
        .skip(parseInt(skip as string))
        .limit(parseInt(limit as string)),
      Reply.countDocuments(filter),
    ]);

    res.json({ success: true, replies, total });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Get single reply */
toolsRouter.get("/db/replies/:id", async (req: Request, res: Response) => {
  try {
    const reply = await Reply.findById(req.params.id as string);
    if (!reply) return res.status(404).json({ success: false, error: "Reply not found" });
    res.json({ success: true, reply });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Update reply — e.g. change status from resolved → replied */
toolsRouter.patch("/db/replies/:id", async (req: Request, res: Response) => {
  try {
    const reply = await Reply.findById(req.params.id as string);
    if (!reply) return res.status(404).json({ success: false, error: "Reply not found" });

    if (reply.status !== EReplyStatus.RESOLVED) {
      return res.status(400).json({
        success: false,
        error: `Cannot mark as replied: current status is "${reply.status}", expected "${EReplyStatus.RESOLVED}"`,
      });
    }

    reply.status = EReplyStatus.REPLIED;
    await reply.save();

    res.json({ success: true, reply });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/** Delete a reply */
toolsRouter.delete("/db/replies/:id", async (req: Request, res: Response) => {
  try {
    const reply = await Reply.findByIdAndDelete(req.params.id as string);
    if (!reply) return res.status(404).json({ success: false, error: "Reply not found" });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DB: Persona Knowledge ─────────────────────────────────────────────────────

toolsRouter.post("/db/persona", async (req: Request, res: Response) => {
  try {
    const knowledge = await PersonaKnowledge.findOneAndUpdate(
      { topic: req.body.topic },
      { $set: req.body },
      { upsert: true, new: true, runValidators: true }
    );
    res.json({ success: true, id: knowledge._id, knowledge });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

toolsRouter.get("/db/persona", async (req: Request, res: Response) => {
  try {
    const { topic } = req.query;
    const filter = topic ? { topic: new RegExp(topic as string, "i") } : {};
    const knowledge = await PersonaKnowledge.find(filter).sort({ topic: 1 });
    res.json({ success: true, knowledge });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DB: Stats ─────────────────────────────────────────────────────────────────

toolsRouter.get("/db/stats", async (_req: Request, res: Response) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [posts_today, posts_draft, posts_posted, replies_today, replies_draft] =
      await Promise.all([
        Post.countDocuments({ created_at: { $gte: today } }),
        Post.countDocuments({ status: "draft" }),
        Post.countDocuments({ status: "posted", created_at: { $gte: today } }),
        Reply.countDocuments({ created_at: { $gte: today } }),
        Reply.countDocuments({ status: "draft" }),
      ]);

    res.json({
      success: true,
      stats: {
        posts_today,
        posts_draft,
        posts_posted,
        replies_today,
        replies_draft,
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});
// ── DB: Curation Sources ──────────────────────────────────────────────────────

/**
 * Batch upsert curation sources.
 * Accepts a single object or an array. Deduplicated by source_url.
 * Auto-calculates engagement_score = likes*1 + retweets*3 + comments*2 + views*0.01
 */
toolsRouter.post("/db/curation", async (req: Request, res: Response) => {
  try {
    const items = (Array.isArray(req.body) ? req.body : [req.body]).map(
      (item: any) => ({
        ...item,
        engagement_score:
          item.engagement_score ??
          (item.likes ?? 0) * 1 +
            (item.retweets ?? 0) * 3 +
            (item.comments ?? 0) * 2 +
            (item.views ?? 0) * 0.01,
        scraped_at: new Date(),
      }),
    );

    const results = await Promise.all(
      items.map((item: any) =>
        CurationSource.findOneAndUpdate(
          { source_url: item.source_url },
          { $set: item },
          { upsert: true, new: true, runValidators: true },
        ),
      ),
    );

    res.json({ success: true, upserted: results.length, sources: results });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/**
 * List curation sources.
 * Query: status, keyword_searched, limit (default 20), skip (default 0)
 */
toolsRouter.get("/db/curation", async (req: Request, res: Response) => {
  try {
    const { status, keyword_searched, limit = "20", skip = "0" } = req.query;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (keyword_searched) filter.keyword_searched = keyword_searched;

    const [sources, total] = await Promise.all([
      CurationSource.find(filter)
        .sort({ engagement_score: -1, scraped_at: -1 })
        .skip(parseInt(skip as string))
        .limit(parseInt(limit as string)),
      CurationSource.countDocuments(filter),
    ]);

    res.json({ success: true, sources, total });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * Get top N curation sources by engagement_score within the last X hours.
 * Query: hours (default 24), limit (default 5), status (default "new")
 */
toolsRouter.get("/db/curation/top", async (req: Request, res: Response) => {
  try {
    const { hours = "24", limit = "5", status = ECurationStatus.NEW } = req.query;
    const since = new Date(
      Date.now() - parseInt(hours as string) * 3_600_000,
    );

    const sources = await CurationSource.find({
      status,
      scraped_at: { $gte: since },
      media_type: { $ne: "none" },
    })
      .sort({ engagement_score: -1 })
      .limit(parseInt(limit as string));

    res.json({ success: true, sources, total: sources.length });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * Auto-Interact Candidates
 * Get top N curation sources by engagement_score (from the last X hours)
 * that have NOT been interacted with yet.
 */
toolsRouter.get("/db/curation/interact-candidates", async (req: Request, res: Response) => {
  try {
    const { hours = "24", limit = "1" } = req.query;
    const since = new Date(Date.now() - parseInt(hours as string) * 3_600_000);

    // Get all interacted URLs
    const interactions = await Interaction.find().select("source_url");
    const interactedUrls = interactions.map(i => i.source_url);

    // Find CurationSource candidates (leftovers from research or already used ones)
    const sources = await CurationSource.find({
      scraped_at: { $gte: since },
      source_url: { $nin: interactedUrls }
    })
      .sort({ engagement_score: -1 })
      .limit(parseInt(limit as string));

    res.json({ success: true, candidates: sources });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Get a single curation source by ID */
toolsRouter.get("/db/curation/:id", async (req: Request, res: Response) => {
  try {
    const source = await CurationSource.findById(req.params.id);
    if (!source)
      return res
        .status(404)
        .json({ success: false, error: "CurationSource not found" });
    res.json({ success: true, source });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Update curation source status or any field */
toolsRouter.patch("/db/curation/:id", async (req: Request, res: Response) => {
  try {
    const source = await CurationSource.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true },
    );
    if (!source)
      return res
        .status(404)
        .json({ success: false, error: "CurationSource not found" });
    res.json({ success: true, source });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// ── DB: Interactions ────────────────────────────────────────────────────────



/** Save a new interaction */
toolsRouter.post("/db/interactions", async (req: Request, res: Response) => {
  try {
    const interaction = await Interaction.create(req.body);
    res.json({ success: true, interaction });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});
