import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { OpenClawService } from '../openclaw/openclaw.service';
import { TelegramService } from '../telegram/telegram.service';
import { EngagementService } from './engagement.service';
import { buildPostCommentPrompt, buildVisibilityCheckPrompt } from '../prompts/kol-prompts';
import { BULL_QUEUES, getApiUrl } from '../common/constants/kol.constants';

interface PostCommentJob {
  pendingCommentId: string;
  kolPostId: string;
  postUrl: string;
}

interface VisibilityCheckJob {
  commentId: string;
  checkIndex: number;
}

@Processor(BULL_QUEUES.ENGAGEMENT)
export class EngagementProcessor {
  private readonly logger = new Logger(EngagementProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly openClaw: OpenClawService,
    private readonly telegramService: TelegramService,
    private readonly engagementService: EngagementService,
  ) {}

  @Process('post-comment')
  async handlePostComment(job: Job<PostCommentJob>): Promise<void> {
    const { pendingCommentId, postUrl } = job.data;
    const apiUrl = getApiUrl();

    const comment = await this.prisma.pendingComment.findUnique({
      where: { id: pendingCommentId },
    });

    if (!comment) {
      this.logger.warn(`Comment ${pendingCommentId} not found`);
      return;
    }

    // Guard: only post APPROVED or AUTO_SELECTED comments
    if (!['APPROVED', 'AUTO_SELECTED'].includes(comment.status)) {
      this.logger.warn(
        `Comment ${pendingCommentId} has status ${comment.status} — skipping`,
      );
      return;
    }

    this.logger.log(`Posting comment ${pendingCommentId} to ${postUrl}`);

    const prompt = buildPostCommentPrompt(postUrl, pendingCommentId, comment.content, apiUrl);

    // OpenClaw executes: navigate → type → submit → callback to /api/tools/kol/comments/:id/posted
    await this.openClaw.executeAgent(prompt);
    // Note: actual DB update happens via the callback endpoint in ToolsController
    // If OpenClaw fails, the job will retry per Bull config
  }

  @Process('visibility-check')
  async handleVisibilityCheck(job: Job<VisibilityCheckJob>): Promise<void> {
    const { commentId, checkIndex } = job.data;
    const apiUrl = getApiUrl();

    const comment = await this.prisma.pendingComment.findUnique({
      where: { id: commentId },
      select: { id: true, postedUrl: true, status: true },
    });

    if (!comment?.postedUrl) {
      this.logger.warn(
        `Comment ${commentId} has no postedUrl — skipping visibility check`,
      );
      return;
    }

    this.logger.log(`Visibility check ${checkIndex} for comment ${commentId}`);

    const prompt = buildVisibilityCheckPrompt(comment.postedUrl, commentId, checkIndex, apiUrl);
    await this.openClaw.executeAgent(prompt);
    // Result handled via callback: POST /api/tools/kol/comments/:id/visibility-result
  }
}
