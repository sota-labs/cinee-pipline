/** KolAnalyzerService — AI-powered analysis for KOL posts and personality learning */
import { log } from "../utils/logger.js";
import { settings } from "../config/settings.js";
import { KolProfile, type IKolProfile } from "../db/models/KolProfile.js";
import {
  KolPost,
  type IKolPost,
  EKolPostStatus,
  ESentiment,
} from "../db/models/KolPost.js";
import {
  buildPostAnalysisPrompt,
  buildCommentPatternPrompt,
  buildPersonalityLearningPrompt,
} from "../prompts/kolPrompts.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";
import { KolSettings } from "../db/models/KolSettings.js";
import type { Types } from "mongoose";

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

export interface IPersonalityUpdate {
  writingStyle: string;
  commonTopics: string[];
  slangWords: string[];
  slangExamples: Array<{ word: string; context: string }>;
  emojiPattern: string;
  sentenceStructure: string;
  engagementTone: string;
  avgPostLength: number;
}

// ── OpenClaw Integration ─────────────────────────────────────────────────────

interface IAnalysisTaskResult {
  type: "post_analysis" | "comment_pattern" | "personality";
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
): Promise<string> {
  const escapedPrompt = prompt.replace(/'/g, "'\''");
  const modelFlag = model ? ` --model ${model}` : "";
  const command = `agent --agent ${settings.openClawAgent}${modelFlag} --message '${escapedPrompt}'`;

  const task = await Task.create({
    type: ETaskType.CRON_JOB_TRIGGER,
    agent: settings.openClawAgent,
    prompt: command,
    status: ETaskStatus.PENDING,
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

export async function processPersonalityResult(
  kolId: string,
  rawResult: string,
): Promise<IPersonalityUpdate | null> {
  const parsed = safeJsonParse<{
    writing_style: string;
    common_topics: string[];
    slang_words: string[];
    slang_examples?: Array<{ word: string; context: string }>;
    emoji_pattern: string;
    sentence_structure: string;
    engagement_tone: string;
    avg_post_length: number;
  }>(rawResult);

  if (!parsed) {
    log.error(
      `[KolAnalyzer] Failed to parse personality result for KOL ${kolId}`,
    );
    return null;
  }

  return {
    writingStyle: parsed.writing_style || "",
    commonTopics: parsed.common_topics || [],
    slangWords: parsed.slang_words || [],
    slangExamples: (parsed.slang_examples || []).map((s) => ({
      word: String(s.word || ""),
      context: String(s.context || ""),
    })),
    emojiPattern: parsed.emoji_pattern || "",
    sentenceStructure: parsed.sentence_structure || "",
    engagementTone: parsed.engagement_tone || "",
    avgPostLength: parsed.avg_post_length || 0,
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
    );
    taskIds.push(analysisTaskId);

    // 2. Comment pattern analysis (if has comments)
    if (post.top_comments.length > 0) {
      const patternPrompt = buildCommentPatternPrompt(post.top_comments);
      const patternTaskId = await queueAnalysisTask(
        "comment_pattern",
        patternPrompt,
        String(post._id),
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
   * Learn personality for a KOL from their recent posts.
   */
  async learnPersonality(kolId: string | Types.ObjectId): Promise<boolean> {
    const kol = await KolProfile.findById(kolId);
    if (!kol) {
      log.error(`[KolAnalyzer] KOL ${kolId} not found`);
      return false;
    }

    // Get recent posts (last 30 days) — any status, we just need content for style learning
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const posts = await KolPost.find({
      kol_id: kolId,
      posted_at: { $gte: thirtyDaysAgo },
      is_retweet: false,
    }).sort({ posted_at: -1 }).limit(30);

    if (posts.length < 1) {
      log.info(
        `[KolAnalyzer] Not enough posts to learn personality for @${kol.handle}`,
      );
      return false;
    }

    // Build prompt
    const prompt = buildPersonalityLearningPrompt({
      handle: kol.handle,
      posts: posts.map((p) => ({ content: p.content, likes: p.likes })),
    });

    // Queue task
    await queueAnalysisTask("personality", prompt, String(kolId), settings.openClawAnalysisModel);

    log.info(
      `[KolAnalyzer] Queued personality learning for @${kol.handle} (${posts.length} posts)`,
    );
    return true;
  }

  /**
   * Apply learned personality to a KOL profile.
   */
  async applyPersonalityUpdate(
    kolId: string,
    update: IPersonalityUpdate,
  ): Promise<void> {
    const kol = await KolProfile.findById(kolId);
    if (!kol) {
      throw new Error(`KOL ${kolId} not found`);
    }

    kol.personality_profile = {
      writing_style: update.writingStyle,
      common_topics: update.commonTopics,
      slang_words: update.slangWords,
      slang_examples: update.slangExamples || [],
      emoji_pattern: update.emojiPattern,
      sentence_structure: update.sentenceStructure,
      engagement_tone: update.engagementTone,
      avg_post_length: update.avgPostLength,
    };

    await kol.save();
    log.info(`[KolAnalyzer] Updated personality profile for @${kol.handle}`);
  }

  /**
   * Run daily personality learning for all KOLs.
   */
  async runDailyPersonalityLearning(): Promise<{
    processed: number;
    failed: number;
  }> {
    const kols = await KolProfile.find({ is_active: true });

    let processed = 0;
    let failed = 0;

    for (const kol of kols) {
      try {
        const success = await this.learnPersonality(kol._id);
        if (success) processed++;
      } catch (error) {
        log.error(
          `[KolAnalyzer] Failed to learn personality for @${kol.handle}`,
        );
        failed++;
      }
    }

    return { processed, failed };
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
