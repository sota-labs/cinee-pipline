/** SelfReplyService — Manage replies to comments on our own posts */
import { log } from "../utils/logger.js";
import { SelfReplyQueue, EQueueStatus, ECommentStatus } from "../db/models/SelfReplyQueue.js";
import { KolSettings } from "../db/models/KolSettings.js";
import { reputationCheckerService } from "./reputationCheckerService.js";
import type { IPendingComment } from "../db/models/SelfReplyQueue.js";
import type { Types } from "mongoose";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IQueueCreateResult {
  queueId: string;
  totalComments: number;
  queuedComments: number;
}

export interface IReplyResult {
  success: boolean;
  replyId?: string;
  error?: string;
}

// ── Main Service ──────────────────────────────────────────────────────────────

export class SelfReplyService {
  /**
   * Create a reply queue when our post gets enough comments.
   */
  async createReplyQueue(
    ourPostId: string | Types.ObjectId,
    postUrl: string,
    comments: Array<{
      comment_id: string;
      author_handle: string;
      content: string;
      likes: number;
      is_hidden?: boolean;
      is_spam?: boolean;
    }>,
  ): Promise<IQueueCreateResult | null> {
    const settings = await KolSettings.getSettings();

    // Check if self-reply is enabled
    if (!settings.self_reply.enabled) {
      log.info("[SelfReply] Self-reply is disabled");
      return null;
    }

    // Check minimum comments threshold
    if (comments.length < settings.self_reply.min_comments_to_trigger) {
      log.info(`[SelfReply] Not enough comments (${comments.length} < ${settings.self_reply.min_comments_to_trigger})`);
      return null;
    }

    // Check if queue already exists
    const existing = await SelfReplyQueue.findOne({ our_post_id: ourPostId });
    if (existing) {
      log.info(`[SelfReply] Queue already exists for post ${ourPostId}`);
      return { queueId: String(existing._id), totalComments: existing.total_comments, queuedComments: 0 };
    }

    // Create queue
    const pendingComments: IPendingComment[] = comments.map((c) => ({
      comment_id: c.comment_id,
      author_handle: c.author_handle,
      content: c.content,
      likes: c.likes,
      engagement_points: 0, // Will be calculated
      author_trust_score: 50, // Default, will be updated
      is_hidden: c.is_hidden || false,
      is_spam: c.is_spam || false,
      status: ECommentStatus.PENDING,
      priority_score: 0,
    }));

    const queue = await SelfReplyQueue.create({
      our_post_id: ourPostId,
      post_url: postUrl,
      pending_comments: pendingComments,
      total_comments: comments.length,
      processed_count: 0,
      queue_status: EQueueStatus.ACTIVE,
      reply_interval_seconds: settings.self_reply.reply_interval_seconds,
    });

    // Rank comments by priority
    await this.rankComments(String(queue._id));

    log.info(`[SelfReply] Created queue ${queue._id} with ${comments.length} comments`);

    return {
      queueId: String(queue._id),
      totalComments: comments.length,
      queuedComments: comments.length,
    };
  }

  /**
   * Rank and prioritize comments in a queue.
   */
  async rankComments(queueId: string): Promise<void> {
    const queue = await SelfReplyQueue.findById(queueId);
    if (!queue) return;

    const settings = await KolSettings.getSettings();
    const weights = settings.self_reply.priority_weights;

    // Check reputation for each comment author
    for (const comment of queue.pending_comments) {
      if (comment.status !== ECommentStatus.PENDING) continue;

      const reputation = await reputationCheckerService.checkReputation(comment.author_handle);

      comment.author_reputation = {
        trust_score: reputation.trustScore,
        checked_at: reputation.checkedAt,
        recommendation: reputation.recommendation,
      };
      comment.author_trust_score = reputation.trustScore;

      // Calculate engagement points
      let engagementPoints = 0;

      // Question bonus
      if (comment.content.includes("?")) {
        engagementPoints += weights.question_bonus;
      }

      // Mention bonus
      if (comment.content.toLowerCase().includes("@")) {
        engagementPoints += weights.mention_bonus;
      }

      // Length bonus (meaningful comments)
      if (comment.content.length > 50) {
        engagementPoints += 2;
      }

      comment.engagement_points = engagementPoints;

      // Calculate priority score
      comment.priority_score =
        comment.likes * weights.likes_multiplier +
        comment.author_trust_score * weights.trust_score_multiplier +
        engagementPoints;
    }

    // Sort by priority score (highest first)
    queue.pending_comments.sort((a, b) => b.priority_score - a.priority_score);

    await queue.save();
    log.info(`[SelfReply] Ranked comments for queue ${queueId}`);
  }

  /**
   * Get next comment to reply to (respecting rate limits).
   */
  async getNextReplyCandidate(queueId: string): Promise<IPendingComment | null> {
    const queue = await SelfReplyQueue.findById(queueId);
    if (!queue || queue.queue_status !== EQueueStatus.ACTIVE) {
      return null;
    }

    // Check rate limit
    if (queue.last_reply_sent_at) {
      const secondsSinceLastReply = (Date.now() - queue.last_reply_sent_at.getTime()) / 1000;
      // Adjust reply speed to a random interval between 1 and 3 minutes (60-180 seconds)
      const randomInterval = Math.floor(Math.random() * (180 - 60 + 1)) + 60;
      if (secondsSinceLastReply < randomInterval) {
        return null; // Rate limited
      }
    }

    // Find highest priority pending comment that is not hidden or spam
    const candidate = queue.pending_comments.find(
      (c) => c.status === ECommentStatus.PENDING && c.author_trust_score >= 30 && !c.is_hidden && !c.is_spam,
    );

    return candidate || null;
  }

  /**
   * Send a reply to a specific comment.
   */
  async sendReply(
    queueId: string,
    commentId: string,
    replyContent: string,
  ): Promise<IReplyResult> {
    const queue = await SelfReplyQueue.findById(queueId);
    if (!queue) {
      return { success: false, error: "Queue not found" };
    }

    const comment = queue.pending_comments.find((c) => c.comment_id === commentId);
    if (!comment) {
      return { success: false, error: "Comment not found" };
    }

    if (comment.status !== ECommentStatus.PENDING) {
      return { success: false, error: "Comment already processed" };
    }

    // Update comment status
    comment.status = ECommentStatus.QUEUED;
    comment.reply_content = replyContent;
    await queue.save();

    // Here you would actually send the reply via OpenClaw
    // For now, we mark as sent immediately (real implementation would queue via Task)
    comment.status = ECommentStatus.SENT;
    comment.replied_at = new Date();
    queue.last_reply_sent_at = new Date();
    queue.processed_count++;

    // Check if queue is complete
    if (queue.processed_count >= queue.total_comments) {
      queue.queue_status = EQueueStatus.COMPLETED;
    }

    await queue.save();

    log.info(`[SelfReply] Reply sent to comment ${commentId} in queue ${queueId}`);

    return { success: true, replyId: `reply_${Date.now()}` };
  }

  /**
   * Skip a comment (mark as skipped without replying).
   */
  async skipComment(queueId: string, commentId: string): Promise<boolean> {
    const queue = await SelfReplyQueue.findById(queueId);
    if (!queue) return false;

    const comment = queue.pending_comments.find((c) => c.comment_id === commentId);
    if (!comment) return false;

    comment.status = ECommentStatus.SKIPPED;
    queue.processed_count++;
    await queue.save();

    log.info(`[SelfReply] Skipped comment ${commentId}`);
    return true;
  }

  /**
   * Pause a queue.
   */
  async pauseQueue(queueId: string): Promise<boolean> {
    const queue = await SelfReplyQueue.findByIdAndUpdate(
      queueId,
      { queue_status: EQueueStatus.PAUSED },
      { new: true },
    );
    return !!queue;
  }

  /**
   * Resume a queue.
   */
  async resumeQueue(queueId: string): Promise<boolean> {
    const queue = await SelfReplyQueue.findByIdAndUpdate(
      queueId,
      { queue_status: EQueueStatus.ACTIVE },
      { new: true },
    );
    return !!queue;
  }

  /**
   * Get all active queues.
   */
  async getActiveQueues(): Promise<Array<{
    queueId: string;
    postUrl: string;
    totalComments: number;
    processedCount: number;
    remainingCount: number;
  }>> {
    const queues = await SelfReplyQueue.find({
      queue_status: { $in: [EQueueStatus.ACTIVE, EQueueStatus.PAUSED] },
    });

    return queues.map((q) => ({
      queueId: String(q._id),
      postUrl: q.post_url,
      totalComments: q.total_comments,
      processedCount: q.processed_count,
      remainingCount: q.total_comments - q.processed_count,
    }));
  }

  /**
   * Process all active queues (send next replies respecting rate limits).
   * Called by cron job.
   */
  async processAllQueues(): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const activeQueues = await this.getActiveQueues();

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const queueInfo of activeQueues) {
      const candidate = await this.getNextReplyCandidate(queueInfo.queueId);
      if (!candidate) continue;

      // Generate reply content (simplified - would use AI in real implementation)
      const replyContent = await this.generateReplyContent(candidate);

      processed++;
      const result = await this.sendReply(queueInfo.queueId, candidate.comment_id, replyContent);

      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }

      // Rate limiting delay between queues
      await delay(5000);
    }

    return { processed, succeeded, failed };
  }

  /**
   * Generate reply content for a comment (placeholder - would use AI).
   */
  private async generateReplyContent(comment: IPendingComment): Promise<string> {
    // Simplified reply generation
    // In real implementation, this would use the AI prompt from kolPrompts.ts
    if (comment.content.includes("?")) {
      return "Great question! Thanks for engaging with the post.";
    }
    return "Thanks for the comment! Appreciate your thoughts.";
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Singleton Export ─────────────────────────────────────────────────────────

export const selfReplyService = new SelfReplyService();
