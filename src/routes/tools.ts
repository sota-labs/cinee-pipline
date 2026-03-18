/** Tool API routes — Python CrewAI agents call these endpoints.
 *
 * Collections:
 *   /db/posts    — CEO's own posts
 *   /db/replies  — CEO's replies (status: draft | rejected | resolved | replied)
 *   /db/curation — AI films found to amplify
 *   /db/persona  — CEO's stances on key topics
 */
import { Router, type Request, type Response } from "express";
import * as memoryTools from "../tools/memoryTools.js";
import * as contentTools from "../tools/contentTools.js";
import { Post, Reply, CurationSource, PersonaKnowledge } from "../db/index.js";
import { EReplyStatus } from "../db/models/Reply.js";

export const toolsRouter = Router();

// ── Memory Tools ──────────────────────────────────────────────────────────────

toolsRouter.post("/memory/store", async (req: Request, res: Response) => {
  const { key, content, metadata, ttl } = req.body;
  res.json(await memoryTools.storeMemory(key, content, metadata, ttl));
});

toolsRouter.get("/memory/retrieve", async (req: Request, res: Response) => {
  res.json(await memoryTools.retrieveMemory(req.query.key as string));
});

toolsRouter.post("/memory/search", async (req: Request, res: Response) => {
  const { query, limit } = req.body;
  res.json(await memoryTools.searchMemories(query, limit || 10));
});

toolsRouter.post("/memory/history", async (req: Request, res: Response) => {
  const { content_type, content, tweet_id, metrics } = req.body;
  res.json(await memoryTools.storeContentHistory(content_type, content, tweet_id, metrics));
});

toolsRouter.get("/memory/recent-history", async (req: Request, res: Response) => {
  const count = parseInt(req.query.count as string) || 10;
  res.json(await memoryTools.getRecentHistory(count));
});

toolsRouter.post("/memory/engagement-pattern", async (req: Request, res: Response) => {
  const { pattern_type, data } = req.body;
  res.json(await memoryTools.storeEngagementPattern(pattern_type, data));
});

// ── Content Tools ─────────────────────────────────────────────────────────────

toolsRouter.post("/content/ideas", (req: Request, res: Response) => {
  res.json(contentTools.generateContentIdeas(req.body.topics, req.body.count));
});

toolsRouter.post("/content/char-count", (req: Request, res: Response) => {
  res.json(contentTools.calculateCharacterCount(req.body.text));
});

toolsRouter.post("/content/format", (req: Request, res: Response) => {
  const { content, hashtags, mention } = req.body;
  res.json({ formatted: contentTools.formatTweet(content, hashtags, mention) });
});

toolsRouter.post("/content/sentiment", (req: Request, res: Response) => {
  res.json(contentTools.analyzeSentiment(req.body.text));
});

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
  console.log("POST /db/replies req.body", req.body);
  try {
    const items = (Array.isArray(req.body) ? req.body : [req.body]).map((item) => ({
      ...item,
      status: "resolved",
    }));
    const replies = await Reply.insertMany(items, { ordered: false });
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
  console.log("PATCH /db/replies/:id req.body", req.body);
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

// ── DB: Curation Sources ──────────────────────────────────────────────────────

toolsRouter.post("/db/curation", async (req: Request, res: Response) => {
  try {
    const source = await CurationSource.findOneAndUpdate(
      { source_url: req.body.source_url },
      { $setOnInsert: req.body },
      { upsert: true, new: true }
    );
    res.json({ success: true, id: source._id, source });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

toolsRouter.get("/db/curation", async (req: Request, res: Response) => {
  try {
    const { used, limit = "10" } = req.query;
    const filter: Record<string, unknown> = {};
    filter.used = used === "true";

    const sources = await CurationSource.find(filter)
      .sort({ engagement_score: -1, created_at: -1 })
      .limit(parseInt(limit as string));

    res.json({ success: true, sources, total: sources.length });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

toolsRouter.patch("/db/curation/:id/used", async (req: Request, res: Response) => {
  try {
    const source = await CurationSource.findByIdAndUpdate(
      req.params.id as string,
      { $set: { used: true } },
      { new: true }
    );
    if (!source) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, source });
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

    const [posts_today, posts_draft, posts_posted, replies_today, replies_draft, curation_unused] =
      await Promise.all([
        Post.countDocuments({ created_at: { $gte: today } }),
        Post.countDocuments({ status: "draft" }),
        Post.countDocuments({ status: "posted", created_at: { $gte: today } }),
        Reply.countDocuments({ created_at: { $gte: today } }),
        Reply.countDocuments({ status: "draft" }),
        CurationSource.countDocuments({ used: false }),
      ]);

    res.json({
      success: true,
      stats: {
        posts_today,
        posts_draft,
        posts_posted,
        replies_today,
        replies_draft,
        curation_unused,
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});
