/** OwnAccountService — personality learning for the CEO's own account */
import { log } from "../utils/logger.js";
import { settings } from "../config/settings.js";
import {
  OwnAccountProfile,
  type IOwnAccountProfile,
  type IOwnAccountManualConfig,
  type IOwnAccountLearnedProfile,
  type IOwnAccountEffectiveProfile,
} from "../db/models/OwnAccountProfile.js";
import { Post, EPostStatus } from "../db/models/Post.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";
import { buildOwnAccountLearningPrompt } from "../prompts/ownAccountPrompts.js";

const MIN_POSTS_REQUIRED = 1;
const CONFIDENCE_THRESHOLD = 60;
const LEARNING_ELIGIBILITY_DELAY_MS = 24 * 60 * 60 * 1000;

class OwnAccountService {
  async getProfile(): Promise<IOwnAccountProfile> {
    const existing = await OwnAccountProfile.findOne({ _key: "own_account" });
    if (existing) return existing;
    return OwnAccountProfile.create({ _key: "own_account" });
  }

  async updateManualConfig(
    config: Partial<IOwnAccountManualConfig>,
  ): Promise<IOwnAccountProfile> {
    const profile = await this.getProfile();
    Object.assign(profile.manual_config, config);
    profile.effective_profile = this.mergeProfiles(
      profile.manual_config,
      profile.learned_profile,
    );
    await profile.save();
    log.info(
      "[OwnAccount] Manual config updated, effective_profile recomputed",
    );
    return profile;
  }

  async learnPersonality(): Promise<string | null> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const posts = await Post.find({
      status: EPostStatus.POSTED,
      platform: "twitter",
      created_at: { $gte: thirtyDaysAgo },
    }).sort({ created_at: -1 });

    if (posts.length < MIN_POSTS_REQUIRED) {
      log.info(
        `[OwnAccount] Not enough posts to learn personality (${posts.length} < ${MIN_POSTS_REQUIRED})`,
      );
      return null;
    }

    const handle = settings.xUsername || "own_account";
    const prompt = buildOwnAccountLearningPrompt({
      handle,
      posts: posts.map((p) => ({ content: p.raw_content })),
    });

    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const command = `agent --agent ${settings.openClawAgent} --message '${escapedPrompt}'`;

    const task = await Task.create({
      type: ETaskType.CRON_JOB_TRIGGER,
      agent: settings.openClawAgent,
      prompt: command,
      status: ETaskStatus.PENDING,
      payload: { analysisType: "own_account_personality" },
    });

    log.info(`[OwnAccount] Queued personality learning task: ${task._id}`);
    return String(task._id);
  }

  async markPostEligibleForLearning(postId: string): Promise<void> {
    const post = await Post.findById(postId).select(
      "status learning_eligible_at",
    );
    if (!post || post.status !== EPostStatus.POSTED) return;
    if (post.learning_eligible_at) return;
    const eligibleAt = new Date(Date.now() + LEARNING_ELIGIBILITY_DELAY_MS);
    await Post.updateOne(
      { _id: postId },
      { $set: { learning_eligible_at: eligibleAt } },
    );
  }

  async autoLearnPersonality(): Promise<string | null> {
    const profile = await this.getProfile();
    const last = profile.learned_profile.last_learn_trigger_at;
    if (last && Date.now() - last.getTime() < LEARNING_ELIGIBILITY_DELAY_MS) {
      log.info(
        `[OwnAccount] Auto-learn skipped — last trigger ${Math.round((Date.now() - last.getTime()) / 3600000)}h ago (< 24h)`,
      );
      return null;
    }

    const eligiblePost = await Post.findOne({
      status: EPostStatus.POSTED,
      learning_eligible_at: { $lte: new Date(), $ne: null },
    })
      .select("_id")
      .lean();
    if (!eligiblePost) {
      log.info(
        "[OwnAccount] Auto-learn skipped — no eligible POSTED posts past 24h",
      );
      return null;
    }

    const taskId = await this.learnPersonality();
    if (taskId) {
      profile.learned_profile.last_learn_trigger_at = new Date();
      await profile.save();
    }
    return taskId;
  }

  async applyLearnedProfile(rawResult: string): Promise<boolean> {
    const profile = await this.getProfile();

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawResult);
    } catch {
      log.error(
        "[OwnAccount] Failed to parse AI result for personality learning",
      );
      return false;
    }

    if (!parsed || typeof parsed !== "object") return false;
    const data = parsed as Record<string, unknown>;

    if (typeof data.writing_style !== "string") {
      log.error("[OwnAccount] Invalid AI result — missing writing_style");
      return false;
    }

    const confidence =
      typeof data.learning_confidence === "number"
        ? Math.min(100, Math.max(0, data.learning_confidence))
        : 75;

    profile.learned_profile = {
      writing_style: String(data.writing_style ?? ""),
      slang_words: Array.isArray(data.slang_words)
        ? (data.slang_words as string[])
        : [],
      emoji_pattern: String(data.emoji_pattern ?? ""),
      sentence_structure: String(data.sentence_structure ?? ""),
      engagement_tone: String(data.engagement_tone ?? ""),
      avg_post_length:
        typeof data.avg_post_length === "number" ? data.avg_post_length : 0,
      last_learned_at: new Date(),
      last_learn_trigger_at: profile.learned_profile.last_learn_trigger_at,
      posts_analyzed: (profile.learned_profile.posts_analyzed ?? 0) + 1,
      learning_confidence: confidence,
    };

    profile.effective_profile = this.mergeProfiles(
      profile.manual_config,
      profile.learned_profile,
    );
    await profile.save();

    log.info(
      `[OwnAccount] Applied learned profile (confidence: ${confidence})`,
    );
    return true;
  }

  private mergeProfiles(
    manual: IOwnAccountManualConfig,
    learned: IOwnAccountLearnedProfile,
  ): IOwnAccountEffectiveProfile {
    const useLearned = learned.learning_confidence >= CONFIDENCE_THRESHOLD;

    return {
      writing_style:
        useLearned && learned.writing_style
          ? learned.writing_style
          : manual.writing_style,
      emoji_pattern:
        useLearned && learned.emoji_pattern
          ? learned.emoji_pattern
          : manual.emoji_pattern,
      sentence_structure:
        useLearned && learned.sentence_structure
          ? learned.sentence_structure
          : manual.sentence_structure,
      engagement_tone:
        useLearned && learned.engagement_tone
          ? learned.engagement_tone
          : manual.engagement_tone,
      avg_post_length:
        useLearned && learned.avg_post_length > 0
          ? learned.avg_post_length
          : manual.avg_post_length,
      slang_words: [
        ...new Set([...manual.slang_words, ...learned.slang_words]),
      ],
    };
  }
}

export const ownAccountService = new OwnAccountService();
