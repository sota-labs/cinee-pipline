/** ReputationCheckerService — Check KOL and commenter reputation for safety */
import { log } from "../utils/logger.js";
import {
  KolReputationCache,
  EReputationRecommendation,
  type IKolReputationCache,
} from "../db/models/KolReputationCache.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IReputationResult {
  handle: string;
  trustScore: number;
  recommendation: EReputationRecommendation;
  metrics: {
    accountAgeDays: number;
    followerCount: number;
    tweetCount: number;
    verifiedStatus: boolean;
    spamScore: number;
    botProbability: number;
    engagementAuthenticity: number;
  };
  cached: boolean;
  checkedAt: Date;
}

export interface IPostQualityResult {
  isSpam: boolean;
  isHidden: boolean;
  isControversial: boolean;
  qualityScore: number;
  riskFactors: string[];
  recommendation: EReputationRecommendation;
}

export interface IVisibilityResult {
  isVisible: boolean;
  hiddenReason?: string;
  showMoreClicked: boolean;
  spamFiltered: boolean;
}

export interface ISafetyCheckResult {
  passed: boolean;
  failedChecks: string[];
  warnings: string[];
}

// ── OpenClaw Integration ─────────────────────────────────────────────────────

const REPUTATION_CHECK_PROMPT_TEMPLATE = `You are ReputationChecker. Analyze this X/Twitter account:

Handle: @{{handle}}

Your task:
1. Navigate to https://x.com/{{handle}}
2. Extract public metrics:
   - Account age (from join date)
   - Follower count
   - Tweet count
   - Verified status
3. Analyze recent activity for red flags:
   - Suspension history indicators
   - Spam patterns
   - Bot-like behavior
   - Engagement authenticity
4. Calculate overall trust score (0-100)

Return JSON:
{
  "account_age_days": 365,
  "follower_count": 10000,
  "tweet_count": 5000,
  "verified_status": true,
  "recent_suspension_flags": 0,
  "spam_score": 10,
  "bot_probability": 5,
  "engagement_authenticity": 85,
  "trust_score": 75,
  "recommendation": "proceed"
}

recommendation: "proceed" | "caution" | "skip"`;

const POST_QUALITY_PROMPT_TEMPLATE = `You are QualityChecker. Analyze this post:

Post URL: {{post_url}}
Content Preview: {{content_preview}}

Your task:
1. Navigate to the post
2. Check for:
   - Spam indicators (excessive hashtags, all caps, suspicious links)
   - Hidden/flagged status (show more clicked, not visible)
   - Controversial content flags
   - Comment authenticity (bot vs real engagement)
3. Assess overall quality

Return JSON:
{
  "is_spam": false,
  "is_hidden": false,
  "is_controversial": false,
  "quality_score": 80,
  "risk_factors": [],
  "recommendation": "proceed"
}`;

// ── Main Service ────────────────────────────────────────────────────────────

export class ReputationCheckerService {
  private readonly CACHE_TTL_HOURS = 24;

  /**
   * Check reputation of an account (with caching).
   */
  async checkReputation(handle: string): Promise<IReputationResult> {
    const normalizedHandle = handle.replace(/^@/, "").toLowerCase();

    // Check cache first
    const cached = await this.getCachedReputation(normalizedHandle);
    if (cached) {
      return { ...cached, cached: true };
    }

    // Queue reputation check via OpenClaw
    const prompt = REPUTATION_CHECK_PROMPT_TEMPLATE.replace(
      /\{\{handle\}\}/g,
      normalizedHandle,
    );

    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const command = `message --session isolated --content '${escapedPrompt}' --no-deliver`;

    const task = await Task.create({
      type: ETaskType.CRON_JOB_TRIGGER,
      agent: "openclaw",
      prompt: command,
      status: ETaskStatus.PENDING,
      payload: { action: "reputation_check", handle: normalizedHandle },
    });

    log.info(`[ReputationChecker] Queued check for @${normalizedHandle}: ${task._id}`);

    // Return placeholder while check is pending
    return {
      handle: normalizedHandle,
      trustScore: 50,
      recommendation: EReputationRecommendation.CAUTION,
      metrics: {
        accountAgeDays: 0,
        followerCount: 0,
        tweetCount: 0,
        verifiedStatus: false,
        spamScore: 50,
        botProbability: 50,
        engagementAuthenticity: 50,
      },
      cached: false,
      checkedAt: new Date(),
    };
  }

  /**
   * Process reputation check result from OpenClaw.
   */
  async processReputationResult(
    handle: string,
    rawResult: string,
  ): Promise<IReputationResult | null> {
    try {
      const parsed = JSON.parse(rawResult) as {
        account_age_days: number;
        follower_count: number;
        tweet_count: number;
        verified_status: boolean;
        recent_suspension_flags: number;
        spam_score: number;
        bot_probability: number;
        engagement_authenticity: number;
        trust_score: number;
        recommendation: string;
      };

      const cacheEntry = await KolReputationCache.findOneAndUpdate(
        { handle },
        {
          handle,
          checked_at: new Date(),
          ttl_hours: this.CACHE_TTL_HOURS,
          metrics: {
            account_age_days: parsed.account_age_days,
            follower_count: parsed.follower_count,
            tweet_count: parsed.tweet_count,
            verified_status: parsed.verified_status,
            recent_suspension_flags: parsed.recent_suspension_flags,
            spam_score: parsed.spam_score,
            bot_probability: parsed.bot_probability,
            engagement_authenticity: parsed.engagement_authenticity,
          },
          trust_score: parsed.trust_score,
          recommendation: parsed.recommendation as EReputationRecommendation,
        },
        { upsert: true, new: true },
      );

      log.info(`[ReputationChecker] Cached reputation for @${handle}: ${parsed.trust_score}/100`);

      return {
        handle,
        trustScore: parsed.trust_score,
        recommendation: parsed.recommendation as EReputationRecommendation,
        metrics: {
          accountAgeDays: parsed.account_age_days,
          followerCount: parsed.follower_count,
          tweetCount: parsed.tweet_count,
          verifiedStatus: parsed.verified_status,
          spamScore: parsed.spam_score,
          botProbability: parsed.bot_probability,
          engagementAuthenticity: parsed.engagement_authenticity,
        },
        cached: false,
        checkedAt: new Date(),
      };
    } catch (error) {
      log.error(`[ReputationChecker] Failed to parse result for @${handle}: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Get cached reputation if valid.
   */
  private async getCachedReputation(handle: string): Promise<IReputationResult | null> {
    const cache = await KolReputationCache.findOne({ handle });
    if (!cache) return null;

    // Check if cache is still valid
    const cacheExpiry = new Date(cache.checked_at.getTime() + cache.ttl_hours * 60 * 60 * 1000);
    if (new Date() > cacheExpiry) {
      return null;
    }

    return {
      handle: cache.handle,
      trustScore: cache.trust_score,
      recommendation: cache.recommendation,
      metrics: {
        accountAgeDays: cache.metrics.account_age_days,
        followerCount: cache.metrics.follower_count,
        tweetCount: cache.metrics.tweet_count,
        verifiedStatus: cache.metrics.verified_status,
        spamScore: cache.metrics.spam_score,
        botProbability: cache.metrics.bot_probability,
        engagementAuthenticity: cache.metrics.engagement_authenticity,
      },
      cached: true,
      checkedAt: cache.checked_at,
    };
  }

  /**
   * Check post quality before replying.
   */
  async checkPostQuality(postUrl: string, contentPreview: string): Promise<IPostQualityResult> {
    const prompt = POST_QUALITY_PROMPT_TEMPLATE
      .replace("{{post_url}}", postUrl)
      .replace("{{content_preview}}", contentPreview.substring(0, 100));

    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const command = `message --session isolated --content '${escapedPrompt}' --no-deliver`;

    await Task.create({
      type: ETaskType.CRON_JOB_TRIGGER,
      agent: "openclaw",
      prompt: command,
      status: ETaskStatus.PENDING,
      payload: { action: "post_quality_check", postUrl },
    });

    // Return placeholder (actual check async)
    return {
      isSpam: false,
      isHidden: false,
      isControversial: false,
      qualityScore: 50,
      riskFactors: ["pending_check"],
      recommendation: EReputationRecommendation.CAUTION,
    };
  }

  /**
   * Process post quality result.
   */
  async processPostQualityResult(postUrl: string, rawResult: string): Promise<IPostQualityResult | null> {
    try {
      const parsed = JSON.parse(rawResult) as {
        is_spam: boolean;
        is_hidden: boolean;
        is_controversial: boolean;
        quality_score: number;
        risk_factors: string[];
        recommendation: string;
      };

      return {
        isSpam: parsed.is_spam,
        isHidden: parsed.is_hidden,
        isControversial: parsed.is_controversial,
        qualityScore: parsed.quality_score,
        riskFactors: parsed.risk_factors,
        recommendation: parsed.recommendation as EReputationRecommendation,
      };
    } catch (error) {
      log.error(`[ReputationChecker] Failed to parse quality result: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Run comprehensive safety check before replying.
   */
  async runSafetyCheck(params: {
    kolHandle: string;
    postUrl: string;
    replyContent: string;
    hourlyReplyCount: number;
    hourlyLimit: number;
  }): Promise<ISafetyCheckResult> {
    const failedChecks: string[] = [];
    const warnings: string[] = [];

    // 1. Check rate limits
    if (params.hourlyReplyCount >= params.hourlyLimit) {
      failedChecks.push("hourly_limit_reached");
    }

    // 2. Check KOL reputation
    const reputation = await this.checkReputation(params.kolHandle);
    if (reputation.recommendation === EReputationRecommendation.SKIP) {
      failedChecks.push("kol_low_reputation");
    } else if (reputation.recommendation === EReputationRecommendation.CAUTION) {
      warnings.push("kol_moderate_reputation");
    }

    // 3. Check for duplicate content (simple check)
    const recentReplies = await this.getRecentRepliesContent(params.kolHandle);
    if (recentReplies.some((r) => this.similarity(r, params.replyContent) > 0.8)) {
      failedChecks.push("duplicate_content");
    }

    // 4. Check banned words
    const bannedWords = ["scam", "spam", "fake", "bot"];
    if (bannedWords.some((w) => params.replyContent.toLowerCase().includes(w))) {
      warnings.push("contains_suspicious_words");
    }

    return {
      passed: failedChecks.length === 0,
      failedChecks,
      warnings,
    };
  }

  /**
   * Clean expired cache entries.
   */
  async cleanExpiredCache(): Promise<number> {
    const result = await KolReputationCache.deleteMany({
      checked_at: {
        $lt: new Date(Date.now() - this.CACHE_TTL_HOURS * 60 * 60 * 1000),
      },
    });

    log.info(`[ReputationChecker] Cleaned ${result.deletedCount} expired cache entries`);
    return result.deletedCount || 0;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async getRecentRepliesContent(kolHandle: string): Promise<string[]> {
    // This would query recent replies from DB
    // Simplified for now
    return [];
  }

  private similarity(a: string, b: string): number {
    // Simple Levenshtein-based similarity
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;

    if (longer.length === 0) return 1.0;

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1),
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }
}

// ── Singleton Export ─────────────────────────────────────────────────────────

export const reputationCheckerService = new ReputationCheckerService();
