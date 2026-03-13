/** Tool API routes — endpoints that Python CrewAI agents can call back to. */
import { Router, type Request, type Response } from "express";
import * as twitterTools from "../tools/twitterTools.js";
import * as memoryTools from "../tools/memoryTools.js";
import * as contentTools from "../tools/contentTools.js";
import * as redditTools from "../tools/redditTools.js";
import * as cineeTools from "../tools/cineeTools.js";
import * as db from "../tools/db.js";

export const toolsRouter = Router();

// ── Twitter Tools ──

toolsRouter.post("/twitter/post", async (req: Request, res: Response) => {
  const { text, media_ids } = req.body;
  const result = await twitterTools.postTweet(text, media_ids);
  res.json(result);
});

toolsRouter.post("/twitter/reply", async (req: Request, res: Response) => {
  const { text, tweet_id } = req.body;
  const result = await twitterTools.replyToTweet(text, tweet_id);
  res.json(result);
});

toolsRouter.get("/twitter/mentions", async (req: Request, res: Response) => {
  const maxResults = parseInt(req.query.max_results as string) || 10;
  const sinceId = req.query.since_id as string | undefined;
  const result = await twitterTools.getMentions(maxResults, sinceId);
  res.json(result);
});

toolsRouter.post("/twitter/like", async (req: Request, res: Response) => {
  const result = await twitterTools.likeTweet(req.body.tweet_id);
  res.json(result);
});

toolsRouter.post("/twitter/retweet", async (req: Request, res: Response) => {
  const result = await twitterTools.retweetTweet(req.body.tweet_id);
  res.json(result);
});

toolsRouter.post("/twitter/search", async (req: Request, res: Response) => {
  const { query, max_results } = req.body;
  const result = await twitterTools.searchTweets(query, max_results || 10);
  res.json(result);
});

toolsRouter.post("/twitter/quote", async (req: Request, res: Response) => {
  const { text, tweet_id } = req.body;
  const result = await twitterTools.quoteTweet(text, tweet_id);
  res.json(result);
});

toolsRouter.get("/twitter/tweet/:id", async (req: Request, res: Response) => {
  const result = await twitterTools.getTweetDetails(req.params.id as string);
  res.json(result);
});

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

// ── Reddit Tools ──

toolsRouter.post("/reddit/posts", async (req: Request, res: Response) => {
  const { subreddit, limit, sort_by } = req.body;
  const result = await redditTools.getRedditPosts(subreddit, limit, sort_by);
  res.json(result);
});

toolsRouter.post("/reddit/search", async (req: Request, res: Response) => {
  const { query, subreddit, limit } = req.body;
  const result = await redditTools.searchRedditPosts(query, subreddit, limit);
  res.json(result);
});

toolsRouter.post("/reddit/create", async (req: Request, res: Response) => {
  const { subreddit, title, text } = req.body;
  const result = await redditTools.createRedditPost(subreddit, title, text);
  res.json(result);
});

toolsRouter.post("/reddit/reply", async (req: Request, res: Response) => {
  const { post_id, text } = req.body;
  const result = await redditTools.replyToRedditPost(post_id, text);
  res.json(result);
});

toolsRouter.post("/reddit/monitor", async (_req: Request, res: Response) => {
  const result = await redditTools.monitorAiFilmSubreddits();
  res.json(result);
});

// ── Cinee Tools ──

toolsRouter.post("/cinee/find-films", async (req: Request, res: Response) => {
  const result = await cineeTools.findAiFilmsToAmplify(req.body.count || 5);
  res.json(result);
});

toolsRouter.post("/cinee/draft-comment", (req: Request, res: Response) => {
  const { film_description, creator_handle } = req.body;
  const comment = cineeTools.draftAmplificationComment(film_description, creator_handle);
  res.json({ comment });
});

toolsRouter.post("/cinee/hot-take-topics", (_req: Request, res: Response) => {
  res.json(cineeTools.generateHotTakeTopics());
});

toolsRouter.get("/cinee/engagement-targets", async (_req: Request, res: Response) => {
  const result = await cineeTools.getDailyEngagementTargets();
  res.json(result);
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
