/** KolAnalyzerService — AI-powered analysis for KOL posts */
import { log } from "../utils/logger.js";
import { settings } from "../config/settings.js";
import {
  KolPost,
  type IKolPost,
  EKolPostStatus,
  ESentiment,
} from "../db/models/KolPost.js";
import {
  buildPostAnalysisPrompt,
  buildCommentPatternPrompt,
} from "../prompts/kolPrompts.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";
import { KolSettings } from "../db/models/KolSettings.js";
import { KolProfile } from "../db/models/KolProfile.js";
import { tierToPriority } from "../utils/taskPriority.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IAnalysisResult {
  summary: string;
  sentiment: ESentiment;
  trendingTopics: string[];
  viralityScore: number;
}

export interface IEngagementPattern {
  dominantTone: string;
  commonPhrases: string[];
  emojiTrend: string[];
  questionRatio: number;
  successfulReplyTypes: string;
}

// ── OpenClaw Integration ─────────────────────────────────────────────────────

interface IAnalysisTaskResult {
  type: "post_analysis" | "comment_pattern";
  postId?: string;
  kolId?: string;
  result: unknown;
  completedAt: Date;
}

/**
 * Queue an analysis task via OpenClaw.
 */
async function queueAnalysisTask(
  type: IAnalysisTaskResult["type"],
  prompt: string,
  relatedId: string,
  model?: string,
  priority?: number,
  handleGroup?: string | null,
): Promise<string> {
  const escapedPrompt = prompt.replace(/'/g, "'\''");
  const modelFlag = model ? ` --model ${model}` : "";
  const command = `agent --agent ${settings.openClawAgent}${modelFlag} --message '${escapedPrompt}'`;

  const task = await Task.create({
    type: ETaskType.CRON_JOB_TRIGGER,
    agent: settings.openClawAgent,
    prompt: command,
    status: ETaskStatus.PENDING,
    priority: priority ?? 0,
    ...(handleGroup != null ? { handle_group: handleGroup } : {}),
    payload: { analysisType: type, relatedId },
  });

  log.info(`[KolAnalyzer] Queued ${type} task: ${task._id}`);
  return String(task._id);
}

// ── Result Processors ─────────────────────────────────────────────────────────

function safeJsonParse<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export async function processPostAnalysisResult(
  postId: string,
  rawResult: string,
): Promise<IAnalysisResult | null> {
  const parsed = safeJsonParse<{
    summary: string;
    sentiment: string;
    trending_topics: string[];
    virality_score: number;
    is_spam?: boolean;
    is_controversial?: boolean;
    quality_score?: number;
    risk_factors?: string[];
    recommendation?: string;
  }>(rawResult);

  if (!parsed) {
    log.error(
      `[KolAnalyzer] Failed to parse analysis result for post ${postId}`,
    );
    return null;
  }

  // Validate sentiment
  const sentiment = Object.values(ESentiment).includes(
    parsed.sentiment as ESentiment,
  )
    ? (parsed.sentiment as ESentiment)
    : ESentiment.NEUTRAL;

  return {
    summary: parsed.summary,
    sentiment,
    trendingTopics: parsed.trending_topics || [],
    viralityScore: Math.max(0, Math.min(100, parsed.virality_score || 0)),
  };
}

export async function processCommentPatternResult(
  postId: string,
  rawResult: string,
): Promise<IEngagementPattern | null> {
  const parsed = safeJsonParse<{
    dominant_tone: string;
    common_phrases: string[];
    emoji_trend: string[];
    question_ratio: number;
    successful_reply_types: string;
  }>(rawResult);

  if (!parsed) {
    log.error(
      `[KolAnalyzer] Failed to parse pattern result for post ${postId}`,
    );
    return null;
  }

  return {
    dominantTone: parsed.dominant_tone || "neutral",
    commonPhrases: parsed.common_phrases || [],
    emojiTrend: parsed.emoji_trend || [],
    questionRatio: Math.max(0, Math.min(1, parsed.question_ratio || 0)),
    successfulReplyTypes: parsed.successful_reply_types || "",
  };
}

// ── Main Service ─────────────────────────────────────────────────────────────

export class KolAnalyzerService {
  /**
   * Analyze all NEW posts that haven't been analyzed yet.
   */
  async analyzePendingPosts(): Promise<{
    queued: number;
    errors: number;
  }> {
    const { analyze_batch_size } = await KolSettings.getSettings();

    const pendingPosts = await KolPost.find({
      status: EKolPostStatus.NEW,
      comments_crawled: true,
    })
      .sort({ crawled_at: 1 })
      .limit(analyze_batch_size);

    log.info(`[KolAnalyzer] Found ${pendingPosts.length} posts to analyze`);

    let queued = 0;
    let errors = 0;

    for (const post of pendingPosts) {
      try {
        await this.queuePostAnalysis(post);
        queued++;
      } catch (error) {
        log.error(
          `[KolAnalyzer] Failed to queue analysis for post ${post._id}`,
        );
        errors++;
      }
    }

    return { queued, errors };
  }

  /**
   * Queue analysis tasks for a single post.
   * Uses atomic status transition to prevent duplicate queuing.
   */
  async queuePostAnalysis(post: IKolPost): Promise<string[]> {
    // Atomic claim: only proceed if post is still NEW
    const claimed = await KolPost.findOneAndUpdate(
      { _id: post._id, status: EKolPostStatus.NEW },
      { $set: { status: EKolPostStatus.ANALYZING } },
    );
    if (!claimed) {
      log.info(`[KolAnalyzer] Post ${post._id} already claimed for analysis — skipping`);
      return [];
    }

    // Lookup KOL tier for priority propagation
    const kol = await KolProfile.findById(post.kol_id).select("tier handle").lean();
    const priority = kol ? tierToPriority(kol.tier) : 0;
    const handleGroup = kol?.handle ?? null;

    const taskIds: string[] = [];

    // 1. Post content analysis
    const analysisPrompt = buildPostAnalysisPrompt({
      postContent: post.content,
      likes: post.likes,
      comments: post.comments,
      retweets: post.retweets,
      views: post.views,
    });

    const analysisTaskId = await queueAnalysisTask(
      "post_analysis",
      analysisPrompt,
      String(post._id),
      undefined,
      priority,
      handleGroup,
    );
    taskIds.push(analysisTaskId);

    // 2. Comment pattern analysis (if has comments)
    if (post.top_comments.length > 0) {
      const patternPrompt = buildCommentPatternPrompt(post.top_comments);
      const patternTaskId = await queueAnalysisTask(
        "comment_pattern",
        patternPrompt,
        String(post._id),
        undefined,
        priority,
        handleGroup,
      );
      taskIds.push(patternTaskId);
    }

    log.info(
      `[KolAnalyzer] Queued ${taskIds.length} analysis tasks for post ${post._id}`,
    );
    return taskIds;
  }

  /**
   * Apply analysis results to a post.
   */
  async applyAnalysisResults(
    postId: string,
    analysis: IAnalysisResult,
    pattern?: IEngagementPattern,
  ): Promise<void> {
    const post = await KolPost.findById(postId);
    if (!post) {
      throw new Error(`Post ${postId} not found`);
    }

    post.analysis = {
      summary: analysis.summary,
      sentiment: analysis.sentiment,
      trending_topics: analysis.trendingTopics,
      virality_score: analysis.viralityScore,
    };

    if (pattern) {
      post.engagement_pattern = {
        dominant_tone: pattern.dominantTone,
        common_phrases: pattern.commonPhrases,
        emoji_trend: pattern.emojiTrend,
        question_ratio: pattern.questionRatio,
      };
    }

    post.status = EKolPostStatus.ANALYZED;
    post.analyzed_at = new Date();

    await post.save();
    log.info(`[KolAnalyzer] Applied analysis to post ${postId}`);
  }

  /**
   * Apply only the engagement pattern to a post (does not touch analysis fields).
   */
  async applyEngagementPattern(
    postId: string,
    pattern: IEngagementPattern,
  ): Promise<void> {
    await KolPost.findByIdAndUpdate(postId, {
      $set: {
        "engagement_pattern.dominant_tone": pattern.dominantTone,
        "engagement_pattern.common_phrases": pattern.commonPhrases,
        "engagement_pattern.emoji_trend": pattern.emojiTrend,
        "engagement_pattern.question_ratio": pattern.questionRatio,
      },
    });
    log.info(`[KolAnalyzer] Applied engagement pattern to post ${postId}`);
  }

  /**
   * Get pending analysis tasks.
   */
  async getPendingAnalysisTasks(): Promise<
    Array<{
      taskId: string;
      type: string;
      relatedId: string;
      status: string;
    }>
  > {
    const tasks = await Task.find({
      type: ETaskType.CRON_JOB_TRIGGER,
      agent: "openclaw",
      "payload.analysisType": { $exists: true },
      status: { $in: [ETaskStatus.PENDING, ETaskStatus.PROCESSING] },
    }).lean();

    return tasks.map((t) => ({
      taskId: String(t._id),
      type: (t.payload as Record<string, string>)?.analysisType || "unknown",
      relatedId: (t.payload as Record<string, string>)?.relatedId || "unknown",
      status: t.status,
    }));
  }
}

// ── Singleton Export ─────────────────────────────────────────────────────────

export const kolAnalyzerService = new KolAnalyzerService();
