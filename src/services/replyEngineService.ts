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
import { shouldSkipPost } from "../utils/kolPostSkipRules.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";
import { ownAccountService } from "./ownAccountService.js";
import type { Types } from "mongoose";

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

const REPLY_EXECUTE_PROMPT_TEMPLATE = `You are a browser automation agent. EXECUTE these steps immediately. Do NOT explain or plan — act now.

Role: Senior Browser Automation Specialist.
Objective: Post a specific reply to X using absolute literal strings to avoid tool errors.
Target URL: {{post_url}}

PHASE 1: TARGETING
1. Navigate to: {{post_url}}
2. Wait 5s.
3. Identify the reply area. Look for a div with \`contenteditable="true"\` and \`role="textbox"\`. 

PHASE 2: THE "CLICK-BEFORE-TYPE" SEQUENCE
1. Focus: Perform a mouse click at the center of the textbox. 
2. Tool Instruction: Use the native \`type\` method. 
3. Literal String: You MUST type the following exact string: "{{reply_content}}"
   - DO NOT use variables. 
   - DO NOT use evaluate.
   - If the tool asks for "text", provide the string above directly.

PHASE 3: REACT ACTIVATION
1. If the "Reply" button remains disabled after typing:
   - Click the end of the text you just typed.
   - Press "Space" once, then "Backspace" once. 
   - This will force X's React state to recognize the input.

PHASE 4: SUBMISSION & VERIFY
1. Click the button: \`[data-testid="tweetButtonInline"]\`.
2. Verification: Wait 3s. Check if the text "{{reply_content}}" appears as a new tweet from your account in the current thread.

RETURN FORMAT:
<<<RESPONSE_START>>>
{
  "success": boolean,
  "handle_used": "string",
  "comment_id": "string_url",
  "error": "null_or_reason"
}
<<<RESPONSE_END>>>`;

/**
 * Queue reply execution task via OpenClaw.
 */
async function queueReplyExecution(
  postUrl: string,
  replyContent: string,
  suggestionId: string,
): Promise<string> {
  const escapedContent = replyContent.replace(/'/g, "'\''");
  const prompt = REPLY_EXECUTE_PROMPT_TEMPLATE
    .replace("{{post_url}}", postUrl)
    .replace("{{reply_content}}", escapedContent);

  const escapedPrompt = prompt.replace(/'/g, "'\''");
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
    // Atomic status transition: only one cron tick can claim this post
    const post = await KolPost.findOneAndUpdate(
      { _id: postId, status: EKolPostStatus.ANALYZED, comments_crawled: true },
      { $set: { status: EKolPostStatus.PENDING_REPLY } },
      { new: true },
    ).populate("kol_id");

    if (!post) {
      log.warn(`[ReplyEngine] Post ${postId} not available for suggestion generation (not found or already claimed)`);
      return null;
    }

    const kol = await KolProfile.findById(post.kol_id);
    if (!kol) {
      log.error(`[ReplyEngine] KOL for post ${postId} not found`);
      return null;
    }

    const settings = await KolSettings.getSettings();

    // Tier S bypasses all skip rules
    if (kol.tier !== "S") {
      if (shouldSkipPost({
        content: post.content,
        isRetweet: post.is_retweet,
        isQuote: post.is_quote,
        quotedPostUrl: post.quoted_post_url,
        cashtagWhitelist: settings.afk_skip_cashtag_whitelist,
      })) {
        await KolPost.findByIdAndUpdate(post._id, { status: EKolPostStatus.SKIPPED });
        log.info(`[ReplyEngine] Skipped post ${post._id} — matched AFK skip rule`);
        return null;
      }
    }

    // Build generation prompt using Ethan's learned personality from DB
    const ownProfile = await ownAccountService.getProfile();
    const ethan = ownProfile.effective_profile;

    const authorVoiceStyle = ethan.writing_style || appSettings.role.authorVoiceStyle;
    const authorSlangReference = ethan.slang_words.length > 0
      ? ethan.slang_words.join(", ")
      : appSettings.role.authorSlangReference;

    const prompt = buildReplyGenerationPrompt({
      handle: kol.handle,
      postSummary: post.analysis?.summary ?? "",
      trendingTopics: post.analysis?.trending_topics ?? [],
      topComments: (post.top_comments ?? []).slice(0, 5).map((c) => ({
        content: c.content,
        author_handle: c.author_handle,
        sentiment: c.sentiment ?? "neutral",
      })),
      postContent: post.content,
      dominantTone: post.engagement_pattern?.dominant_tone ?? "neutral",
      commonPhrases: post.engagement_pattern?.common_phrases ?? [],
      emojiTrend: post.engagement_pattern?.emoji_trend ?? [],
      authorVoiceStyle,
      authorSlangReference,
      authorStyleFormulas: appSettings.role.authorStyleFormulas,
    });

    // Get mode from already-fetched settings
    const mode = settings.default_mode;

    // Queue generation task via OpenClaw
    const escapedPrompt = prompt.replace(/'/g, "'\''");
    const command = `agent --agent ${appSettings.openClawAgent} --model ${appSettings.openClawAnalysisModel} --message '${escapedPrompt}'`;

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

      // Route based on current global mode, not the stale mode stored on suggestion
      const currentSettings = await KolSettings.getSettings();
      if (currentSettings.default_mode === EReplyMode.AFK) {
        suggestion.mode = EReplyMode.AFK;
        await suggestion.save();
        await this.processAFKMode(suggestion);
      } else {
        suggestion.mode = EReplyMode.MANUAL;
        await suggestion.save();
        await this.processManualMode(suggestion);
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
   * Select the best suggestion by confidence threshold + post quality check.
   * Shared by both AFK and Manual modes.
   */
  private async selectBestSuggestion(
    suggestion: IKolReplySuggestion,
  ): Promise<ISuggestion | null> {
    const settings = await KolSettings.getSettings();
    const minConfidence = settings.afk.min_confidence_threshold;

    const best = suggestion.suggestions
      .filter((s) => s.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence)[0];

    if (!best) return null;

    const post = await KolPost.findById(suggestion.kol_post_id);
    if (!post || (post.analysis?.virality_score ?? 0) < 30) return null;

    return best;
  }

  /**
   * Process AFK mode: auto-select best suggestion and schedule.
   */
  private async processAFKMode(suggestion: IKolReplySuggestion): Promise<void> {
    const best = await this.selectBestSuggestion(suggestion);

    if (!best) {
      log.info(
        `[ReplyEngine] No suggestion meets AFK threshold for ${suggestion._id}, converting to manual`,
      );
      await this.convertToManualMode(suggestion);
      return;
    }

    // Schedule with random delay
    const settings = await KolSettings.getSettings();
    const delayMin = settings.afk.auto_delay_min_minutes;
    const delayMax = settings.afk.auto_delay_max_minutes;
    const delayMinutes = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;

    suggestion.selected_suggestion_id = best.id;
    suggestion.auto_reply_scheduled_at = new Date(Date.now() + delayMinutes * 60 * 1000);
    await suggestion.save();

    log.info(
      `[ReplyEngine] AFK reply scheduled for ${suggestion._id} in ${delayMinutes} minutes`,
    );
  }

  /**
   * Process Manual mode: pre-select best suggestion and send streamlined Telegram confirmation.
   * Falls back to full suggestion list if no suggestion meets threshold.
   */
  private async processManualMode(suggestion: IKolReplySuggestion): Promise<void> {
    const best = await this.selectBestSuggestion(suggestion);

    if (best) {
      suggestion.selected_suggestion_id = best.id;
      await suggestion.save();

      const { sendConfirmationRequest } = await import("../telegram/kolTelegramBotNative.js");
      await sendConfirmationRequest(suggestion);
    } else {
      // No suggestion meets threshold — show full list for manual pick
      const { sendSuggestionForReview } = await import("../telegram/kolTelegramBotNative.js");
      await sendSuggestionForReview(suggestion);
    }
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

      suggestion.execution_status = EReplyExecutionStatus.EXECUTING;
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
   * Auto-reject manual suggestions that exceeded the configured timeout.
   * Called by cron every 10 minutes.
   */
  async runAutoRejectExpired(): Promise<{ rejected: number }> {
    const settings = await KolSettings.getSettings();
    const timeoutMinutes = settings.manual.auto_reject_after_minutes;
    const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);

    const expired = await KolReplySuggestion.find({
      mode: EReplyMode.MANUAL,
      execution_status: EReplyExecutionStatus.PENDING,
      admin_decision: { $exists: false },
      created_at: { $lte: cutoff },
    });

    for (const suggestion of expired) {
      suggestion.admin_decision = EAdminDecision.REJECTED;
      suggestion.admin_decided_at = new Date();
      suggestion.execution_status = EReplyExecutionStatus.FAILED;
      suggestion.error_message = "Auto-rejected: no response within timeout";
      await suggestion.save();
    }

    if (expired.length > 0) {
      log.info(`[ReplyEngine] Auto-rejected ${expired.length} expired manual suggestions`);
    }

    return { rejected: expired.length };
  }

  /**
   * Run scheduled AFK replies (called by cron job).
   */
  async runScheduledAFKReplies(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const settings = await KolSettings.getSettings();
    if (settings.default_mode !== EReplyMode.AFK) {
      log.info("[ReplyEngine] AFK mode disabled globally — skipping scheduled replies");
      return { processed: 0, succeeded: 0, failed: 0 };
    }

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
