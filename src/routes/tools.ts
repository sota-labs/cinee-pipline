/** Tool API routes — Python CrewAI agents call these endpoints.
 *
 * Collections:
 *   /db/posts          — CEO's own posts
 *   /db/interactions   — Incoming tweets/comments from others
 *   /db/replies        — CEO's replies to interactions
 *   /db/curation       — AI films found to amplify
 *   /db/persona        — CEO's stances on key topics
 */
import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import * as memoryTools from "../tools/memoryTools.js";
import * as contentTools from "../tools/contentTools.js";
import {
  Post,
  Interaction,
  Reply,
  CurationSource,
  PersonaKnowledge,
} from "../db/index.js";

export const toolsRouter = Router();

// ── Memory Tools ─────────────────────────────────────────────────────────────

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
  const { topics, count } = req.body;
  res.json(contentTools.generateContentIdeas(topics, count));
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

/** Create a draft post */
toolsRouter.post("/db/posts", async (req: Request, res: Response) => {
  try {
    const post = await Post.create(req.body);
    res.json({ success: true, id: post._id, post });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/** List posts — supports ?status=&content_type=&limit=&skip= */
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

/** Get single post by Mongo _id */
toolsRouter.get("/db/posts/:id", async (req: Request, res: Response) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, error: "Post not found" });
    res.json({ success: true, post });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Update post — used to set platform_id, status, metadata after publishing */
toolsRouter.patch("/db/posts/:id", async (req: Request, res: Response) => {
  try {
    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true, runValidators: true }
    );
    if (!post) return res.status(404).json({ success: false, error: "Post not found" });
    res.json({ success: true, post });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/** Check duplicate content (last N hours) */
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

// ── DB: Interactions ──────────────────────────────────────────────────────────

/** Save an incoming mention/comment to process */
toolsRouter.post("/db/interactions", async (req: Request, res: Response) => {
  try {
    const interaction = await Interaction.findOneAndUpdate(
      { platform_id: req.body.platform_id },
      { $setOnInsert: req.body },
      { upsert: true, new: true }
    );
    res.json({ success: true, id: interaction._id, interaction });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/** Get unprocessed interactions */
toolsRouter.get("/db/interactions", async (req: Request, res: Response) => {
  try {
    const { processed, platform, limit = "20" } = req.query;
    const filter: Record<string, unknown> = {};
    if (processed !== undefined) filter.processed = processed === "true";
    if (platform) filter.platform = platform;

    const interactions = await Interaction.find(filter)
      .sort({ created_at: -1 })
      .limit(parseInt(limit as string));

    res.json({ success: true, interactions, total: interactions.length });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Mark interaction as processed */
toolsRouter.patch("/db/interactions/:id/processed", async (req: Request, res: Response) => {
  try {
    const interaction = await Interaction.findByIdAndUpdate(
      req.params.id,
      { $set: { processed: true, context_summary: req.body.context_summary } },
      { new: true }
    );
    if (!interaction) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, interaction });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DB: Replies ───────────────────────────────────────────────────────────────

/** Save a reply after publishing */
toolsRouter.post("/db/replies", async (req: Request, res: Response) => {
  try {
    const reply = await Reply.create(req.body);
    res.json({ success: true, id: reply._id, reply });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

/** Get all replies for an interaction */
toolsRouter.get("/db/replies/:interactionId", async (req: Request, res: Response) => {
  try {
    const interactionId = req.params.interactionId as string;
    if (!Types.ObjectId.isValid(interactionId)) {
      return res.status(400).json({ success: false, error: "Invalid interaction id" });
    }
    const replies = await Reply.find({ interaction_id: new Types.ObjectId(interactionId) })
      .sort({ created_at: -1 });
    res.json({ success: true, replies });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DB: Curation Sources ──────────────────────────────────────────────────────

/** Save an AI film found by OpenClaw */
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

/** Get unused curation sources (films ready to be amplified) */
toolsRouter.get("/db/curation", async (req: Request, res: Response) => {
  try {
    const { used, limit = "10" } = req.query;
    const filter: Record<string, unknown> = {};
    if (used !== undefined) filter.used = used === "true";
    else filter.used = false;

    const sources = await CurationSource.find(filter)
      .sort({ engagement_score: -1, created_at: -1 })
      .limit(parseInt(limit as string));

    res.json({ success: true, sources, total: sources.length });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Mark a curation source as used */
toolsRouter.patch("/db/curation/:id/used", async (req: Request, res: Response) => {
  try {
    const source = await CurationSource.findByIdAndUpdate(
      req.params.id,
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

/** Upsert a topic stance */
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

/** Get all persona knowledge (AI reads this before writing) */
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

    const [
      posts_today,
      posts_draft,
      posts_posted,
      interactions_pending,
      replies_today,
      curation_unused,
    ] = await Promise.all([
      Post.countDocuments({ created_at: { $gte: today } }),
      Post.countDocuments({ status: "draft" }),
      Post.countDocuments({ status: "posted", created_at: { $gte: today } }),
      Interaction.countDocuments({ processed: false }),
      Reply.countDocuments({ created_at: { $gte: today } }),
      CurationSource.countDocuments({ used: false }),
    ]);

    res.json({
      success: true,
      stats: {
        posts_today,
        posts_draft,
        posts_posted,
        interactions_pending,
        replies_today,
        curation_unused,
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});
