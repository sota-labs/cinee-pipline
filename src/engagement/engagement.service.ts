import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { KOL_CONSTANTS, BULL_QUEUES } from '../common/constants/kol.constants';

export type VisibilityStatus = 'visible' | 'collapsed' | 'flagged' | 'unknown';

export interface VisibilityCheckResult {
  status: VisibilityStatus;
  checkIndex: number;
  checkedAt: Date;
}

@Injectable()
export class EngagementService {
  private readonly logger = new Logger(EngagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(BULL_QUEUES.ENGAGEMENT) private readonly engagementQueue: Queue,
  ) {}

  async scheduleVisibilityCheck(commentId: string, checkIndex: number): Promise<void> {
    if (checkIndex >= KOL_CONSTANTS.VISIBILITY_CHECK_COUNT) {
      this.logger.log(
        `All ${KOL_CONSTANTS.VISIBILITY_CHECK_COUNT} visibility checks done for comment ${commentId}`,
      );
      return;
    }

    const jobId = `vis-${commentId}-${checkIndex + 1}`;
    await this.engagementQueue.add(
      'visibility-check',
      { commentId, checkIndex: checkIndex + 1 },
      {
        delay: KOL_CONSTANTS.VISIBILITY_CHECK_INTERVAL_MS,
        jobId,
        attempts: 2,
        backoff: 30_000,
      },
    );

    this.logger.log(
      `Scheduled visibility check ${checkIndex + 1}/${KOL_CONSTANTS.VISIBILITY_CHECK_COUNT} for comment ${commentId} in 5 min`,
    );
  }

  async recordVisibilityResult(
    commentId: string,
    result: VisibilityCheckResult,
  ): Promise<void> {
    const comment = await this.prisma.pendingComment.findUnique({ where: { id: commentId } });
    if (!comment) return;

    let finalStatus: string | undefined;
    if (result.status === 'visible') {
      finalStatus = 'POSTED';
    } else if (result.status === 'flagged') {
      finalStatus = 'FAILED';
    } else if (result.status === 'collapsed') {
      finalStatus = 'POSTED';
    } else if (result.checkIndex >= KOL_CONSTANTS.VISIBILITY_CHECK_COUNT) {
      finalStatus = 'POSTED'; // exhausted checks, assume posted
    }

    if (finalStatus) {
      await this.prisma.pendingComment.update({
        where: { id: commentId },
        data: { status: finalStatus as never },
      });
      this.logger.log(
        `Comment ${commentId} final status: ${finalStatus} (visibility: ${result.status})`,
      );
    }

    // Schedule next check if not yet resolved and checks remain
    if (!finalStatus && result.checkIndex < KOL_CONSTANTS.VISIBILITY_CHECK_COUNT) {
      await this.scheduleVisibilityCheck(commentId, result.checkIndex);
    }
  }

  async getCommentStatus(commentId: string) {
    return this.prisma.pendingComment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        status: true,
        postedAt: true,
        postedUrl: true,
        content: true,
      },
    });
  }

  computeRandomDelay(minMinutes: number, maxMinutes: number): number {
    const minMs = minMinutes * 60 * 1000;
    const maxMs = maxMinutes * 60 * 1000;
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  }
}
