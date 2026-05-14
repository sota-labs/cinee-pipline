/** ReplyEngineService — Generate suggestions and manage reply execution (AFK + Manual modes) */
import { log } from "../utils/logger.js";
import { OUTPUT_FORMAT_INSTRUCTION } from "../prompts/outputFormat.js";
import { settings as appSettings } from "../config/settings.js";
import { KolProfile } from "../db/models/KolProfile.js";
import { KolPost, EKolPostStatus } from "../db/models/KolPost.js";
import {
  KolReplySuggestion,
  EReplyMode,
  EReplyExecutionStatus,
  EAdminDecision,
  type IKolReplySuggestion,
  type ISuggestion,
} from "../db/models/KolReplySuggestion.js";
import { KolSettings } from "../db/models/KolSettings.js";
import { KolReputationCache } from "../db/models/KolReputationCache.js";
import { buildReplyGenerationPrompt } from "../prompts/kolPrompts.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";
import type { Types } from "mongoose";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IGenerateSuggestionsResult {
  suggestionId: string;
  suggestionsCount: number;
  mode: EReplyMode;
  confidence: number;
}

export interface IExecuteResult {
  success: boolean;
  commentId?: string;
  error?: string;
}

// ── OpenClaw Integration ─────────────────────────────────────────────────────

const REPLY_EXECUTE_PROMPT_TEMPLATE = `Role: You are a Senior Browser Automation Specialist acting as a Human Proxy.
Objective: Navigate to a specific X (Twitter) status and post a reply while bypassing bot detection through human-mimicry behaviors.

Target URL: {{post_url}}
Reply Content: {{reply_content}}

EXECUTION LOGIC (STRICT ADHERENCE):
Initialize Real Browser Context:
- Disable Simulation Mode. Enable Interactive Browser Mode.
- Ensure the session is authenticated. If a login screen appears, stop and report {"success": false, "error": "auth_required"}.

Human-Mimicry Navigation:
- Navigate to the Target URL.
- Wait for 4-6 seconds for the DOM to fully load.
- Perform a natural scroll: Scroll down 400px and back up 150px to simulate a user reading the post.

Keystroke Level Interaction:
- Locate the reply area using data-testid="tweetTextarea_0".
- Action: Hover the mouse over the element for 1 second before clicking.
- Typing: Use the type method with a random delay of 70ms - 200ms between characters. Do NOT use paste or fill commands.
- Verification: Ensure the text "{{reply_content}}" is correctly entered into the field.

Submission & Verification:
- Wait 2.5 seconds after typing (as if proofreading).
- Click the "Reply" button (selector: data-testid="tweetButtonInline").
- Wait for the success toast message or the appearance of the new tweet in the thread.

Error Handling & Retries:
- Rate Limited: If a "Rate limit exceeded" message appears, wait 60 seconds and retry EXACTLY once.
- Post Status: If the post is deleted or the account is private, report {"success": false, "error": "post_not_accessible"}.
- Wait Time: Maintain a mandatory 2-3 second pause between every major browser action.

RETURN JSON FORMAT:
{
  "success": boolean,
  "comment_id": "string_or_url",
  "posted_at": "ISO-8601-Timestamp",
  "error": "null_or_reason_for_failure"
}
${OUTPUT_FORMAT_INSTRUCTION}`;

/**
 * Queue reply execution task via OpenClaw.
 */
async function queueReplyExecution(
  postUrl: string,
  replyContent: string,
  suggestionId: string,
): Promise<string> {
  const escapedContent = replyContent.replace(/'/g, "'\\''");
  const prompt = REPLY_EXECUTE_PROMPT_TEMPLATE
    .replace("{{post_url}}", postUrl)
    .replace("{{reply_content}}", escapedContent);

  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  const command = `agent --agent ${appSettings.openClawAgent} --message '${escapedPrompt}'`;

  const task = await Task.create({
    type: ETaskType.CRON_JOB_TRIGGER,
    agent: appSettings.openClawAgent,
    prompt: command,
    status: ETaskStatus.PENDING,
    payload: { suggestionId, action: "execute_reply" },
  });

  log.info(`[ReplyEngine] Queued reply execution task: ${task._id}`);
  return String(task._id);
}

// ── Suggestion Generation ───────────────────────────────────────────────────

export class ReplyEngineService {
  /**
   * Generate reply suggestions for an analyzed post.
   */
  async generateSuggestions(postId: string | Types.ObjectId): Promise<IKolReplySuggestion | null> {
    const post = await KolPost.findById(postId).populate("kol_id");
    if (!post) {
      log.error(`[ReplyEngine] Post ${postId} not found`);
      return null;
    }

    if (post.status !== EKolPostStatus.ANALYZED) {
      log.warn(`[ReplyEngine] Post ${postId} not yet analyzed`);
      return null;
    }

    const kol = await KolProfile.findById(post.kol_id);
    if (!kol) {
      log.error(`[ReplyEngine] KOL for post ${postId} not found`);
      return null;
    }

    // Build generation prompt
    const prompt = buildReplyGenerationPrompt({
      handle: kol.handle,
      writingStyle: kol.personality_profile.writing_style,
      topics: kol.personality_profile.common_topics,
      slangs: kol.personality_profile.slang_words,
      tone: kol.personality_profile.engagement_tone,
      postContent: post.content,
      dominantTone: post.engagement_pattern.dominant_tone,
      commonPhrases: post.engagement_pattern.common_phrases,
      emojiTrend: post.engagement_pattern.emoji_trend,
    });

    // Get settings for mode
    const settings = await KolSettings.getSettings();
    const mode = settings.default_mode;

    // Queue generation task via OpenClaw
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const command = `agent --agent ${appSettings.openClawAgent} --message '${escapedPrompt}'`;

    // Create placeholder suggestion (will be filled when task completes)
    const suggestion = await KolReplySuggestion.create({
      kol_post_id: postId,
      suggestions: [],
      mode,
      execution_status: EReplyExecutionStatus.PENDING,
    });

    const task = await Task.create({
      type: ETaskType.CRON_JOB_TRIGGER,
      agent: appSettings.openClawAgent,
      prompt: command,
      status: ETaskStatus.PENDING,
      payload: {
        action: "generate_suggestions",
        postId: String(postId),
        suggestionId: String(suggestion._id),
        mode,
      },
    });

    // Update post status
    post.status = EKolPostStatus.PENDING_REPLY;
    await post.save();

    log.info(
      `[ReplyEngine] Queued suggestion generation for post ${postId} ` +
        `(task: ${task._id}, suggestion: ${suggestion._id})`,
    );

    return suggestion;
  }

  /**
   * Process generated suggestions from OpenClaw result.
   */
  async processGeneratedSuggestions(
    suggestionId: string,
    rawResult: string,
  ): Promise<boolean> {
    const suggestion = await KolReplySuggestion.findById(suggestionId);
    if (!suggestion) {
      log.error(`[ReplyEngine] Suggestion ${suggestionId} not found`);
      return false;
    }

    try {
      const parsed = JSON.parse(rawResult) as {
        suggestions: Array<{
          content: string;
          tone: string;
          confidence: number;
          reasoning: string;
          expected_engagement: number;
        }>;
      };

      if (!parsed.suggestions || !Array.isArray(parsed.suggestions)) {
        throw new Error("Invalid suggestions format");
      }

      // Map and validate suggestions
      suggestion.suggestions = parsed.suggestions.map((s, index) => ({
        id: `sugg_${index + 1}`,
        content: s.content,
        tone: s.tone,
        confidence: Math.max(0, Math.min(100, s.confidence)),
        reasoning: s.reasoning || "",
        expected_engagement: s.expected_engagement || 0,
      }));

      await suggestion.save();

      log.info(
        `[ReplyEngine] Processed ${suggestion.suggestions.length} suggestions for ${suggestionId}`,
      );

      // Route based on mode
      if (suggestion.mode === EReplyMode.AFK) {
        await this.processAFKMode(suggestion);
      } else {
        // Manual mode: Send Telegram notification
        const { sendSuggestionForReview } = await import("../telegram/kolTelegramBotNative.js");
        await sendSuggestionForReview(suggestion);
      }

      return true;
    } catch (error) {
      log.error(`[ReplyEngine] Failed to process suggestions: ${(error as Error).message}`);
      suggestion.execution_status = EReplyExecutionStatus.FAILED;
      suggestion.error_message = `Parse error: ${(error as Error).message}`;
      await suggestion.save();
      return false;
    }
  }

  /**
   * Process AFK mode: auto-select best suggestion and schedule.
   */
  private async processAFKMode(suggestion: IKolReplySuggestion): Promise<void> {
    const settings = await KolSettings.getSettings();
    const minConfidence = settings.afk.min_confidence_threshold;

    // Find best suggestion meeting threshold
    const bestSuggestion = suggestion.suggestions
      .filter((s) => s.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence)[0];

    if (!bestSuggestion) {
      log.info(
        `[ReplyEngine] No suggestion meets AFK threshold (${minConfidence}) for ${suggestion._id}, converting to manual`,
      );
      await this.convertToManualMode(suggestion);
      return;
    }

    // Check post quality before auto-replying
    const post = await KolPost.findById(suggestion.kol_post_id);
    if (!post) return;

    // Simple quality check (virality score > 30)
    if (post.analysis.virality_score < 30) {
      log.info(`[ReplyEngine] Post quality too low for AFK, converting to manual`);
      await this.convertToManualMode(suggestion);
      return;
    }

    // Schedule with random delay
    const delayMin = settings.afk.auto_delay_min_minutes;
    const delayMax = settings.afk.auto_delay_max_minutes;
    const delayMinutes = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;

    suggestion.selected_suggestion_id = bestSuggestion.id;
    suggestion.auto_reply_scheduled_at = new Date(Date.now() + delayMinutes * 60 * 1000);
    await suggestion.save();

    log.info(
      `[ReplyEngine] AFK reply scheduled for ${suggestion._id} in ${delayMinutes} minutes`,
    );
  }

  /**
   * Convert a suggestion from AFK to Manual mode.
   */
  async convertToManualMode(suggestion: IKolReplySuggestion): Promise<void> {
    suggestion.mode = EReplyMode.MANUAL;
    suggestion.auto_reply_scheduled_at = undefined;
    await suggestion.save();

    log.info(`[ReplyEngine] Converted suggestion ${suggestion._id} to Manual mode`);

    // Note: Telegram notification will be sent by telegram bot service
  }

  /**
   * Execute a reply (for both AFK approved and Manual approved).
   */
  async executeReply(suggestionId: string): Promise<IExecuteResult> {
    const suggestion = await KolReplySuggestion.findById(suggestionId).populate("kol_post_id");
    if (!suggestion) {
      return { success: false, error: "Suggestion not found" };
    }

    const post = suggestion.kol_post_id as unknown as KolPostDoc;
    if (!post) {
      return { success: false, error: "Associated post not found" };
    }

    // Get reply content
    let replyContent: string;
    if (suggestion.admin_decision === EAdminDecision.EDITED && suggestion.admin_edited_content) {
      replyContent = suggestion.admin_edited_content;
    } else if (suggestion.selected_suggestion_id) {
      const selected = suggestion.suggestions.find(
        (s) => s.id === suggestion.selected_suggestion_id,
      );
      if (!selected) {
        return { success: false, error: "Selected suggestion not found" };
      }
      replyContent = selected.content;
    } else {
      return { success: false, error: "No reply content available" };
    }

    // Check rate limits
    const settings = await KolSettings.getSettings();
    const hourlyCount = await this.getHourlyReplyCount();
    if (hourlyCount >= settings.afk.hourly_reply_limit) {
      return { success: false, error: "Hourly reply limit reached" };
    }

    // Queue execution
    try {
      const taskId = await queueReplyExecution(post.post_url, replyContent, suggestionId);

      suggestion.execution_status = EReplyExecutionStatus.PENDING;
      await suggestion.save();

      log.info(`[ReplyEngine] Queued reply execution for ${suggestionId} (task: ${taskId})`);

      return { success: true };
    } catch (error) {
      log.error(`[ReplyEngine] Failed to queue execution: ${(error as Error).message}`);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Process execution result from OpenClaw.
   */
  async processExecutionResult(
    suggestionId: string,
    rawResult: string,
  ): Promise<IExecuteResult> {
    const suggestion = await KolReplySuggestion.findById(suggestionId);
    if (!suggestion) {
      return { success: false, error: "Suggestion not found" };
    }

    try {
      const parsed = JSON.parse(rawResult) as {
        success: boolean;
        comment_id?: string;
        error?: string;
      };

      if (parsed.success && parsed.comment_id) {
        suggestion.execution_status = EReplyExecutionStatus.SENT;
        suggestion.sent_comment_id = parsed.comment_id;
        suggestion.sent_at = new Date();
        await suggestion.save();

        // Update post status
        await KolPost.findByIdAndUpdate(suggestion.kol_post_id, {
          status: EKolPostStatus.REPLIED,
          replied_at: new Date(),
          replied_comment_id: parsed.comment_id,
        });

        log.info(`[ReplyEngine] Reply executed successfully: ${parsed.comment_id}`);
        return { success: true, commentId: parsed.comment_id };
      } else {
        const errorMsg = parsed.error || "Unknown execution error";
        suggestion.execution_status = errorMsg.includes("ban")
          ? EReplyExecutionStatus.BANNED
          : EReplyExecutionStatus.FAILED;
        suggestion.error_message = errorMsg;
        await suggestion.save();

        log.error(`[ReplyEngine] Reply execution failed: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = `Parse error: ${(error as Error).message}`;
      suggestion.execution_status = EReplyExecutionStatus.FAILED;
      suggestion.error_message = errorMsg;
      await suggestion.save();

      return { success: false, error: errorMsg };
    }
  }

  /**
   * Admin approves a suggestion (Manual mode).
   */
  async approveSuggestion(
    suggestionId: string,
    suggestionIndex: number,
    editedContent?: string,
  ): Promise<IExecuteResult> {
    const suggestion = await KolReplySuggestion.findById(suggestionId);
    if (!suggestion) {
      return { success: false, error: "Suggestion not found" };
    }

    if (suggestion.mode !== EReplyMode.MANUAL) {
      return { success: false, error: "Not in manual mode" };
    }

    const selected = suggestion.suggestions[suggestionIndex];
    if (!selected) {
      return { success: false, error: "Invalid suggestion index" };
    }

    suggestion.selected_suggestion_id = selected.id;
    suggestion.admin_decision = editedContent
      ? EAdminDecision.EDITED
      : EAdminDecision.APPROVED;
    suggestion.admin_edited_content = editedContent || selected.content;
    suggestion.admin_decided_at = new Date();
    await suggestion.save();

    log.info(`[ReplyEngine] Suggestion ${suggestionId} approved by admin`);

    // Execute immediately
    return this.executeReply(suggestionId);
  }

  /**
   * Admin rejects a suggestion (Manual mode).
   */
  async rejectSuggestion(suggestionId: string): Promise<boolean> {
    const suggestion = await KolReplySuggestion.findById(suggestionId);
    if (!suggestion) return false;

    suggestion.admin_decision = EAdminDecision.REJECTED;
    suggestion.admin_decided_at = new Date();
    suggestion.execution_status = EReplyExecutionStatus.FAILED;
    await suggestion.save();

    log.info(`[ReplyEngine] Suggestion ${suggestionId} rejected by admin`);
    return true;
  }

  /**
   * Get pending suggestions for manual review.
   */
  async getPendingManualSuggestions(): Promise<IKolReplySuggestion[]> {
    return KolReplySuggestion.find({
      mode: EReplyMode.MANUAL,
      execution_status: EReplyExecutionStatus.PENDING,
      admin_decision: { $exists: false },
    })
      .populate("kol_post_id")
      .sort({ created_at: -1 });
  }

  /**
   * Get suggestions that are scheduled for AFK execution.
   */
  async getScheduledAFKSuggestions(): Promise<IKolReplySuggestion[]> {
    return KolReplySuggestion.find({
      mode: EReplyMode.AFK,
      execution_status: EReplyExecutionStatus.PENDING,
      auto_reply_scheduled_at: { $lte: new Date() },
    }).populate("kol_post_id");
  }

  /**
   * Count hourly replies for rate limiting.
   */
  private async getHourlyReplyCount(): Promise<number> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return KolReplySuggestion.countDocuments({
      execution_status: EReplyExecutionStatus.SENT,
      sent_at: { $gte: oneHourAgo },
    });
  }

  /**
   * Run scheduled AFK replies (called by cron job).
   */
  async runScheduledAFKReplies(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const scheduled = await this.getScheduledAFKSuggestions();

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const suggestion of scheduled) {
      processed++;
      const result = await this.executeReply(String(suggestion._id));
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }

      // Rate limiting delay between replies
      await delay(5000);
    }

    return { processed, succeeded, failed };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type KolPostDoc = InstanceType<typeof KolPost>;

// ── Singleton Export ─────────────────────────────────────────────────────────

export const replyEngineService = new ReplyEngineService();
