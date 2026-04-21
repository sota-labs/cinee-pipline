import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { findPendingCommentById, updatePendingComment, updatePendingCommentsByKolPostId } from '../services/kolPostService.js';
import { TelegramService, ApprovalPayload } from './telegram.service';
import { BULL_QUEUES, KOL_CONSTANTS } from '../common/constants/kol.constants';

interface SendApprovalJob {
  kolPostId: string;
  kolId: string;
  kolHandle: string;
  postContent: string;
  postUrl: string;
  summary: string;
  sentiment: ApprovalPayload['sentiment'];
  candidates: { id: string; content: string; alignment: string }[];
}

interface TimeoutFallbackJob {
  pendingCommentId: string;
  kolPostId: string;
  postUrl: string;
}

@Processor(BULL_QUEUES.TELEGRAM_APPROVAL)
export class TelegramApprovalProcessor {
  private readonly logger = new Logger(TelegramApprovalProcessor.name);

  constructor(
    private readonly telegramService: TelegramService,
    @InjectQueue(BULL_QUEUES.TELEGRAM_APPROVAL) private readonly approvalQueue: Queue,
    @InjectQueue(BULL_QUEUES.ENGAGEMENT) private readonly engagementQueue: Queue,
  ) {}

  @Process('send-approval')
  async handleSendApproval(job: Job<SendApprovalJob>): Promise<void> {
    const { candidates, kolPostId } = job.data;

    // Send Telegram message with inline buttons
    const messageId = await this.telegramService.sendApprovalMessage(job.data);

    // Save messageId to each PendingComment so we can remove buttons later
    await this.kolDb.updatePendingCommentsByKolPostId(kolPostId, { status: 'PENDING_REVIEW' }, { telegramMessageId: messageId });

    // Register a 5-min timeout fallback for EACH candidate
    // (any one of them could be approved — we cancel others on approval)
    for (const candidate of candidates) {
      await this.approvalQueue.add(
        'timeout-fallback',
        {
          pendingCommentId: candidate.id,
          kolPostId,
          postUrl: job.data.postUrl,
        } satisfies TimeoutFallbackJob,
        {
          delay: KOL_CONSTANTS.TIMEOUT_FALLBACK_DELAY_MS,
          jobId: `approval-${candidate.id}`, // deterministic — enables targeted removal
          attempts: 1,
        },
      );
    }

    this.logger.log(
      `Approval message sent (msgId: ${messageId}) with ${candidates.length} timeout jobs registered`,
    );
  }

  @Process('timeout-fallback')
  async handleTimeoutFallback(job: Job<TimeoutFallbackJob>): Promise<void> {
    const { pendingCommentId, kolPostId, postUrl } = job.data;
    this.logger.log(`Timeout fallback triggered for comment ${pendingCommentId}`);

    const comment = await this.kolDb.findPendingCommentById(pendingCommentId);

    // Only act if still pending (another candidate may have already been approved)
    if (!comment || comment.status !== 'PENDING_REVIEW') {
      this.logger.log(
        `Comment ${pendingCommentId} already handled — skipping timeout fallback`,
      );
      return;
    }

    // Auto-select this candidate (manager was AFK)
    await this.kolDb.updatePendingComment(pendingCommentId, { status: 'AUTO_SELECTED', isAutoSelected: true });

    // Reject remaining PENDING_REVIEW siblings
    await this.kolDb.updatePendingCommentsByKolPostId(kolPostId, { status: 'PENDING_REVIEW' }, { status: 'REJECTED' });

    // Enqueue posting with anti-ban delay
    const delayMs = this.randomDelay(
      KOL_CONSTANTS.DEFAULT_REPLY_RATE_LIMIT_MIN,
      KOL_CONSTANTS.DEFAULT_REPLY_RATE_LIMIT_MAX,
    );

    await this.engagementQueue.add(
      'post-comment',
      { pendingCommentId, kolPostId, postUrl },
      { delay: delayMs, attempts: 2, backoff: 60_000 },
    );

    // Notify manager
    await this.telegramService.sendNotification(
      `⏱ <b>Timeout:</b> Auto-posted comment for post (no response in 5 min).\n\n"${comment.content.slice(0, 120)}"`,
    );

    this.logger.log(`Timeout fallback: auto-posted comment ${pendingCommentId}`);
  }

  private randomDelay(minMinutes: number, maxMinutes: number): number {
    const minMs = minMinutes * 60 * 1000;
    const maxMs = maxMinutes * 60 * 1000;
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  }
}
