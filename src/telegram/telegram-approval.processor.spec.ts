import { Test } from '@nestjs/testing';
import { TelegramApprovalProcessor } from './telegram-approval.processor';
import { TelegramService } from './telegram.service';
import { PrismaService } from '../prisma/prisma.service';
import { getQueueToken } from '@nestjs/bull';
import { BULL_QUEUES, KOL_CONSTANTS } from '../common/constants/kol.constants';

const mockPrisma = {
  pendingComment: {
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

const mockTelegramService = {
  sendApprovalMessage: jest.fn().mockResolvedValue('99'),
  sendNotification: jest.fn(),
  cancelTimeoutJob: jest.fn(),
};

const mockApprovalQueue = {
  add: jest.fn().mockResolvedValue({ id: 'j1' }),
};

const mockEngagementQueue = {
  add: jest.fn().mockResolvedValue({ id: 'e1' }),
};

describe('TelegramApprovalProcessor', () => {
  let processor: TelegramApprovalProcessor;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TelegramApprovalProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TelegramService, useValue: mockTelegramService },
        { provide: getQueueToken(BULL_QUEUES.TELEGRAM_APPROVAL), useValue: mockApprovalQueue },
        { provide: getQueueToken(BULL_QUEUES.ENGAGEMENT), useValue: mockEngagementQueue },
      ],
    }).compile();

    processor = module.get(TelegramApprovalProcessor);
    jest.clearAllMocks();
  });

  describe('handleSendApproval', () => {
    const baseJob = {
      data: {
        kolPostId: 'p1',
        kolId: 'k1',
        kolHandle: 'alice',
        postContent: 'content',
        postUrl: 'https://x.com/k/1',
        summary: 'summary',
        sentiment: {
          sentiment: 'positive',
          positive_pct: 60,
          neutral_pct: 30,
          negative_pct: 10,
          trend_summary: 'good',
        },
        candidates: [
          { id: 'c1', content: 'opt1', alignment: 'positive' },
          { id: 'c2', content: 'opt2', alignment: 'neutral' },
          { id: 'c3', content: 'opt3', alignment: 'negative' },
        ],
      },
    };

    it('sends Telegram message once', async () => {
      await processor.handleSendApproval(baseJob as any);
      expect(mockTelegramService.sendApprovalMessage).toHaveBeenCalledTimes(1);
    });

    it('registers timeout-fallback jobs per candidate (3 candidates = 3 jobs)', async () => {
      await processor.handleSendApproval(baseJob as any);
      expect(mockApprovalQueue.add).toHaveBeenCalledTimes(3);
    });

    it('registers timeout-fallback job with correct jobId for each candidate', async () => {
      await processor.handleSendApproval(baseJob as any);
      expect(mockApprovalQueue.add).toHaveBeenCalledWith(
        'timeout-fallback',
        expect.objectContaining({ pendingCommentId: 'c1' }),
        expect.objectContaining({ jobId: 'approval-c1', delay: KOL_CONSTANTS.TIMEOUT_FALLBACK_DELAY_MS }),
      );
      expect(mockApprovalQueue.add).toHaveBeenCalledWith(
        'timeout-fallback',
        expect.objectContaining({ pendingCommentId: 'c2' }),
        expect.objectContaining({ jobId: 'approval-c2' }),
      );
      expect(mockApprovalQueue.add).toHaveBeenCalledWith(
        'timeout-fallback',
        expect.objectContaining({ pendingCommentId: 'c3' }),
        expect.objectContaining({ jobId: 'approval-c3' }),
      );
    });

    it('saves telegramMessageId to all pending comments for the post', async () => {
      await processor.handleSendApproval(baseJob as any);
      expect(mockPrisma.pendingComment.updateMany).toHaveBeenCalledWith({
        where: { kolPostId: 'p1', status: 'PENDING_REVIEW' },
        data: { telegramMessageId: '99' },
      });
    });

    it('sets delay to TIMEOUT_FALLBACK_DELAY_MS on each timeout job', async () => {
      await processor.handleSendApproval(baseJob as any);
      const calls = mockApprovalQueue.add.mock.calls;
      for (const call of calls) {
        expect(call[2].delay).toBe(KOL_CONSTANTS.TIMEOUT_FALLBACK_DELAY_MS);
      }
    });

    it('handles single candidate correctly', async () => {
      const singleCandidateJob = {
        data: { ...baseJob.data, candidates: [{ id: 'c1', content: 'opt1', alignment: 'positive' }] },
      };
      await processor.handleSendApproval(singleCandidateJob as any);
      expect(mockApprovalQueue.add).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleTimeoutFallback', () => {
    it('auto-posts and notifies when comment still pending', async () => {
      mockPrisma.pendingComment.findUnique.mockResolvedValue({
        id: 'c1',
        status: 'PENDING_REVIEW',
        content: 'ok cool',
      });

      await processor.handleTimeoutFallback({
        data: { pendingCommentId: 'c1', kolPostId: 'p1', postUrl: 'https://x.com/k/1' },
      } as any);

      expect(mockPrisma.pendingComment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'AUTO_SELECTED', isAutoSelected: true }),
        }),
      );
      expect(mockEngagementQueue.add).toHaveBeenCalledWith(
        'post-comment',
        expect.objectContaining({ pendingCommentId: 'c1', kolPostId: 'p1' }),
        expect.any(Object),
      );
      expect(mockTelegramService.sendNotification).toHaveBeenCalledWith(
        expect.stringContaining('Timeout'),
      );
    });

    it('rejects sibling pending comments', async () => {
      mockPrisma.pendingComment.findUnique.mockResolvedValue({
        id: 'c1',
        status: 'PENDING_REVIEW',
        content: 'ok cool',
      });

      await processor.handleTimeoutFallback({
        data: { pendingCommentId: 'c1', kolPostId: 'p1', postUrl: 'https://x.com/k/1' },
      } as any);

      expect(mockPrisma.pendingComment.updateMany).toHaveBeenCalledWith({
        where: { kolPostId: 'p1', id: { not: 'c1' }, status: 'PENDING_REVIEW' },
        data: { status: 'REJECTED' },
      });
    });

    it('skips when comment already handled (APPROVED)', async () => {
      mockPrisma.pendingComment.findUnique.mockResolvedValue({
        id: 'c1',
        status: 'APPROVED',
        content: 'ok',
      });

      await processor.handleTimeoutFallback({
        data: { pendingCommentId: 'c1', kolPostId: 'p1', postUrl: 'https://x.com/k/1' },
      } as any);

      expect(mockEngagementQueue.add).not.toHaveBeenCalled();
      expect(mockPrisma.pendingComment.update).not.toHaveBeenCalled();
      expect(mockTelegramService.sendNotification).not.toHaveBeenCalled();
    });

    it('skips when comment not found', async () => {
      mockPrisma.pendingComment.findUnique.mockResolvedValue(null);

      await processor.handleTimeoutFallback({
        data: { pendingCommentId: 'c1', kolPostId: 'p1', postUrl: 'https://x.com/k/1' },
      } as any);

      expect(mockEngagementQueue.add).not.toHaveBeenCalled();
    });

    it('enqueues post-comment with delay within rate limit range', async () => {
      mockPrisma.pendingComment.findUnique.mockResolvedValue({
        id: 'c1',
        status: 'PENDING_REVIEW',
        content: 'ok',
      });

      await processor.handleTimeoutFallback({
        data: { pendingCommentId: 'c1', kolPostId: 'p1', postUrl: 'https://x.com/k/1' },
      } as any);

      const callArgs = mockEngagementQueue.add.mock.calls[0];
      const minMs = KOL_CONSTANTS.DEFAULT_REPLY_RATE_LIMIT_MIN * 60 * 1000;
      const maxMs = KOL_CONSTANTS.DEFAULT_REPLY_RATE_LIMIT_MAX * 60 * 1000;
      expect(callArgs[2].delay).toBeGreaterThanOrEqual(minMs);
      expect(callArgs[2].delay).toBeLessThanOrEqual(maxMs);
    });

    it('includes comment content in notification message', async () => {
      mockPrisma.pendingComment.findUnique.mockResolvedValue({
        id: 'c1',
        status: 'PENDING_REVIEW',
        content: 'this is the comment content',
      });

      await processor.handleTimeoutFallback({
        data: { pendingCommentId: 'c1', kolPostId: 'p1', postUrl: 'https://x.com/k/1' },
      } as any);

      expect(mockTelegramService.sendNotification).toHaveBeenCalledWith(
        expect.stringContaining('this is the comment content'),
      );
    });
  });
});
