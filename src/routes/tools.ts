/** Tool API routes — endpoints that Python CrewAI agents call back to.
 *
 * With the shift to OpenClaw browser automation, Twitter/Reddit/Cinee routes
 * are removed. Only Memory, Content utilities, and Database routes remain.
 */
import { Router, type Request, type Response } from "express";
import * as memoryTools from "../tools/memoryTools.js";
import * as contentTools from "../tools/contentTools.js";
import * as db from "../tools/db.js";

export const toolsRouter = Router();

// ── Memory Tools ──

toolsRouter.post("/memory/store", async (req: Request, res: Response) => {
  const { key, content, metadata, ttl } = req.body;
  const result = await memoryTools.storeMemory(key, content, metadata, ttl);
  res.json(result);
});

toolsRouter.get("/memory/retrieve", async (req: Request, res: Response) => {
  const key = req.query.key as string;
  const result = await memoryTools.retrieveMemory(key);
  res.json(result);
});

toolsRouter.post("/memory/search", async (req: Request, res: Response) => {
  const { query, limit } = req.body;
  const result = await memoryTools.searchMemories(query, limit || 10);
  res.json(result);
});

toolsRouter.post("/memory/history", async (req: Request, res: Response) => {
  const { content_type, content, tweet_id, metrics } = req.body;
  const result = await memoryTools.storeContentHistory(content_type, content, tweet_id, metrics);
  res.json(result);
});

toolsRouter.get("/memory/recent-history", async (req: Request, res: Response) => {
  const count = parseInt(req.query.count as string) || 10;
  const result = await memoryTools.getRecentHistory(count);
  res.json(result);
});

toolsRouter.post("/memory/engagement-pattern", async (req: Request, res: Response) => {
  const { pattern_type, data } = req.body;
  const result = await memoryTools.storeEngagementPattern(pattern_type, data);
  res.json(result);
});

// ── Content Tools ──

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

// ── Database Tools ──

toolsRouter.get("/db/stats", (_req: Request, res: Response) => {
  res.json(db.getDailyStats());
});

toolsRouter.get("/db/recent-posts", (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 20;
  const contentType = req.query.content_type as string | undefined;
  res.json(db.getRecentPosts(limit, contentType));
});

toolsRouter.post("/db/save-post", (req: Request, res: Response) => {
  const { tweet_id, content, content_type, platform, strategy_context } = req.body;
  const id = db.savePost(tweet_id, content, content_type, platform, strategy_context);
  res.json({ id });
});

toolsRouter.get("/db/duplicate-check", (req: Request, res: Response) => {
  const content = req.query.content as string;
  const hours = parseInt(req.query.hours as string) || 48;
  res.json({ is_duplicate: db.isDuplicateContent(content, hours) });
});
