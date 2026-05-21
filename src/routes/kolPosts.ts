/** KolPosts Routes — API endpoints for KOL post management and replies */
import { Router, Request, Response } from "express";
import { KolPost, EKolPostStatus } from "../db/models/KolPost.js";
import { KolReplySuggestion, EReplyMode } from "../db/models/KolReplySuggestion.js";
import { KolProfile } from "../db/models/KolProfile.js";
import { replyEngineService } from "../services/replyEngineService.js";
import { kolAnalyzerService } from "../services/kolAnalyzerService.js";
import { log } from "../utils/logger.js";

const router = Router();

// ── Post Routes ───────────────────────────────────────────────────────────────

/**
 * GET /api/kol-posts — List posts with filters
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};

    if (req.query.kol_id) {
      filter.kol_id = req.query.kol_id;
    }

    if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.platform) {
      filter.platform = req.query.platform;
    }

    if (req.query.min_engagement) {
      filter.engagement_score = { $gte: parseInt(req.query.min_engagement as string) };
    }

    const [posts, total] = await Promise.all([
      KolPost.find(filter)
        .populate("kol_id", "handle display_name reputation_score")
        .sort({ posted_at: -1 })
        .skip(skip)
        .limit(limit),
      KolPost.countDocuments(filter),
    ]);

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
    log.error(`[KolPostsRoute] List error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to list posts" });
  }
});

/**
 * GET /api/kol-posts/:id — Get post by ID
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const post = await KolPost.findById(req.params.id).populate("kol_id");

    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    res.json({ data: post });
  } catch (error) {
    log.error(`[KolPostsRoute] Get error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to get post" });
  }
});

/**
 * POST /api/kol-posts/:id/analyze — Trigger analysis
 */
router.post("/:id/analyze", async (req: Request, res: Response) => {
  try {
    const post = await KolPost.findById(req.params.id);

    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    const taskIds = await kolAnalyzerService.queuePostAnalysis(post);

    res.json({
      message: "Analysis queued",
      data: { taskIds },
    });
  } catch (error) {
    log.error(`[KolPostsRoute] Analyze error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to queue analysis" });
  }
});

// ── Suggestion Routes ─────────────────────────────────────────────────────────

/**
 * GET /api/kol-posts/:id/suggestions — Get suggestions for a post
 */
router.get("/:id/suggestions", async (req: Request, res: Response) => {
  try {
    const suggestions = await KolReplySuggestion.findOne({
      kol_post_id: req.params.id,
    }).sort({ created_at: -1 });

    if (!suggestions) {
      return res.json({ data: null, message: "No suggestions generated yet" });
    }

    res.json({ data: suggestions });
  } catch (error) {
    log.error(`[KolPostsRoute] Suggestions error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to get suggestions" });
  }
});

/**
 * POST /api/kol-posts/:id/suggest — Generate new suggestions
 */
router.post("/:id/suggest", async (req: Request, res: Response) => {
  try {
    const suggestion = await replyEngineService.generateSuggestions(String(req.params.id));

    if (!suggestion) {
      return res.status(400).json({ error: "Could not generate suggestions" });
    }

    res.json({
      message: "Suggestions queued for generation",
      data: { suggestionId: suggestion._id, mode: suggestion.mode },
    });
  } catch (error) {
    log.error(`[KolPostsRoute] Suggest error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to generate suggestions" });
  }
});

/**
 * POST /api/kol-posts/:id/reply — Execute reply for a post
 */
router.post("/:id/reply", async (req: Request, res: Response) => {
  try {
    const { suggestion_id, content } = req.body;

    if (!content) {
      return res.status(400).json({ error: "content is required" });
    }

    const post = await KolPost.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Create suggestion with manual content
    const suggestion = await KolReplySuggestion.create({
      kol_post_id: String(req.params.id),
      suggestions: [
        {
          id: "manual_1",
          content,
          tone: "manual",
          confidence: 100,
          reasoning: "Direct user input",
          expected_engagement: 0,
        },
      ],
      mode: EReplyMode.MANUAL,
      selected_suggestion_id: "manual_1",
      admin_decision: "approved" as const,
      admin_edited_content: content,
      admin_decided_at: new Date(),
    });

    const result = await replyEngineService.executeReply(String((suggestion as { _id: string })._id));

    res.json({
      message: result.success ? "Reply executed" : "Reply failed",
      data: result,
    });
  } catch (error) {
    log.error(`[KolPostsRoute] Reply error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to execute reply" });
  }
});

// ── Reply Management Routes ───────────────────────────────────────────────────

/**
 * GET /api/replies/pending — Get pending manual reviews
 */
router.get("/replies/pending", async (req: Request, res: Response) => {
  try {
    const pending = await replyEngineService.getPendingManualSuggestions();

    res.json({
      data: pending,
      count: pending.length,
    });
  } catch (error) {
    log.error(`[KolPostsRoute] Pending error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to get pending replies" });
  }
});

/**
 * POST /api/replies/:id/approve — Approve and execute a reply
 */
router.post("/replies/:id/approve", async (req: Request, res: Response) => {
  try {
    const { suggestion_index, edited_content } = req.body;

    const result = await replyEngineService.approveSuggestion(
      String(req.params.id),
      suggestion_index || 0,
      edited_content,
    );

    res.json({
      message: result.success ? "Reply approved and sent" : "Reply failed",
      data: result,
    });
  } catch (error) {
    log.error(`[KolPostsRoute] Approve error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to approve reply" });
  }
});

/**
 * POST /api/replies/:id/reject — Reject a reply
 */
router.post("/replies/:id/reject", async (req: Request, res: Response) => {
  try {
    const success = await replyEngineService.rejectSuggestion(String(req.params.id));

    res.json({
      message: success ? "Reply rejected" : "Failed to reject reply",
      data: { success },
    });
  } catch (error) {
    log.error(`[KolPostsRoute] Reject error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to reject reply" });
  }
});

/**
 * POST /api/replies/:id/skip — Skip a reply (mark as done without sending)
 */
router.post("/replies/:id/skip", async (req: Request, res: Response) => {
  try {
    const suggestion = await KolReplySuggestion.findByIdAndUpdate(
      req.params.id,
      {
        execution_status: "skipped" as const,
      },
      { new: true },
    );

    if (!suggestion) {
      return res.status(404).json({ error: "Suggestion not found" });
    }

    res.json({ message: "Reply skipped", data: suggestion });
  } catch (error) {
    log.error(`[KolPostsRoute] Skip error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to skip reply" });
  }
});

// ── Stats Routes ──────────────────────────────────────────────────────────────

/**
 * GET /api/kol-posts/stats/overview — Get overview stats
 */
router.get("/stats/overview", async (_req: Request, res: Response) => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      posts24h,
      posts7d,
      analyzed,
      pendingReply,
      replied,
      suggestions24h,
    ] = await Promise.all([
      KolPost.countDocuments({ crawled_at: { $gte: twentyFourHoursAgo } }),
      KolPost.countDocuments({ crawled_at: { $gte: sevenDaysAgo } }),
      KolPost.countDocuments({ status: EKolPostStatus.ANALYZED }),
      KolPost.countDocuments({ status: EKolPostStatus.PENDING_REPLY }),
      KolPost.countDocuments({ status: EKolPostStatus.REPLIED }),
      KolReplySuggestion.countDocuments({ created_at: { $gte: twentyFourHoursAgo } }),
    ]);

    res.json({
      data: {
        posts_24h: posts24h,
        posts_7d: posts7d,
        analyzed,
        pending_reply: pendingReply,
        replied,
        suggestions_24h: suggestions24h,
      },
    });
  } catch (error) {
    log.error(`[KolPostsRoute] Stats error: ${(error as Error).message}`);
    res.status(500).json({ error: "Failed to get stats" });
  }
});

/**
 * PATCH /api/kol-posts/:id/comments — Save crawled comments and mark comments_crawled
 */
router.patch("/:id/comments", async (req: Request, res: Response) => {
  try {
    const { top_comments } = req.body;
    if (!Array.isArray(top_comments)) {
      return res.status(400).json({ error: "top_comments must be an array" });
    }
    const post = await KolPost.findByIdAndUpdate(
      req.params.id,
      { top_comments, comments_crawled: true },
      { new: true },
    );
    if (!post) return res.status(404).json({ error: "Post not found" });

    // Trigger analysis now that comments are available
    setImmediate(async () => {
      try {
        const taskIds = await kolAnalyzerService.queuePostAnalysis(post);
        if (taskIds.length > 0) {
          log.info(`[kolPosts] Queued analysis for post ${post._id} after comment crawl`);
        }
      } catch (err: unknown) {
        log.error(`[kolPosts] Failed to queue analysis after comment crawl: ${(err as Error).message}`);
      }
    });

    res.json({ success: true, post });
  } catch (err: unknown) {
    log.error(`[kolPosts] PATCH /:id/comments error: ${(err as Error).message}`);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
