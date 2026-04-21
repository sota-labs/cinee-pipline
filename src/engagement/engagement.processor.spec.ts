import { Test } from '@nestjs/testing';
import { EngagementProcessor } from './engagement.processor';
import { KolDbService } from '../kol/kol-db.service';
import { OpenClawService } from '../openclaw/openclaw.service';
import { TelegramService } from '../telegram/telegram.service';
import { EngagementService } from './engagement.service';

const mockKolDb = {
  findPendingCommentById: jest.fn(),
};

const mockOpenClaw = {
  executeAgent: jest.fn().mockResolvedValue('COMMENT_POSTED: c1 at https://x.com/u/1'),
};
const mockTelegram = { sendNotification: jest.fn() };
const mockEngagementService = { scheduleVisibilityCheck: jest.fn() };

describe('EngagementProcessor', () => {
  let processor: EngagementProcessor;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EngagementProcessor,
        { provide: KolDbService, useValue: mockKolDb },
        { provide: OpenClawService, useValue: mockOpenClaw },
        { provide: TelegramService, useValue: mockTelegram },
        { provide: EngagementService, useValue: mockEngagementService },
      ],
    }).compile();
    processor = module.get(EngagementProcessor);
    jest.clearAllMocks();
  });

  describe('handlePostComment', () => {
    it('calls OpenClaw executeAgent for APPROVED comment', async () => {
      mockKolDb.findPendingCommentById.mockResolvedValue({
        id: 'c1',
        content: 'great post!',
        status: 'APPROVED',
      });

      await processor.handlePostComment({
        data: { pendingCommentId: 'c1', kolPostId: 'p1', postUrl: 'https://x.com/kol/1' },
      } as never);

      expect(mockOpenClaw.executeAgent).toHaveBeenCalledTimes(1);
      expect(mockOpenClaw.executeAgent).toHaveBeenCalledWith(expect.stringContaining('c1'));
    });

    it('calls OpenClaw for AUTO_SELECTED comment', async () => {
      mockKolDb.findPendingCommentById.mockResolvedValue({
        id: 'c1',
        content: 'nice!',
        status: 'AUTO_SELECTED',
      });

      await processor.handlePostComment({
        data: { pendingCommentId: 'c1', kolPostId: 'p1', postUrl: 'https://x.com/kol/1' },
      } as never);

      expect(mockOpenClaw.executeAgent).toHaveBeenCalledTimes(1);
    });

    it('skips posting for REJECTED comment', async () => {
      mockKolDb.findPendingCommentById.mockResolvedValue({
        id: 'c1',
        content: 'skip me',
        status: 'REJECTED',
      });

      await processor.handlePostComment({
        data: { pendingCommentId: 'c1', kolPostId: 'p1', postUrl: 'https://x.com/kol/1' },
      } as never);

      expect(mockOpenClaw.executeAgent).not.toHaveBeenCalled();
    });

    it('skips when comment not found', async () => {
      mockKolDb.findPendingCommentById.mockResolvedValue(null);

      await processor.handlePostComment({
        data: { pendingCommentId: 'bad-id', kolPostId: 'p1', postUrl: 'https://x.com/kol/1' },
      } as never);

      expect(mockOpenClaw.executeAgent).not.toHaveBeenCalled();
    });
  });

  describe('handleVisibilityCheck', () => {
    it('calls OpenClaw with visibility check prompt when postedUrl exists', async () => {
      mockKolDb.findPendingCommentById.mockResolvedValue({
        id: 'c1',
        postedUrl: 'https://x.com/u/status/123',
        status: 'APPROVED',
      });

      await processor.handleVisibilityCheck({
        data: { commentId: 'c1', checkIndex: 1 },
      } as never);

      expect(mockOpenClaw.executeAgent).toHaveBeenCalledTimes(1);
      expect(mockOpenClaw.executeAgent).toHaveBeenCalledWith(expect.stringContaining('c1'));
    });

    it('skips when no postedUrl', async () => {
      mockKolDb.findPendingCommentById.mockResolvedValue({
        id: 'c1',
        postedUrl: null,
        status: 'APPROVED',
      });

      await processor.handleVisibilityCheck({
        data: { commentId: 'c1', checkIndex: 1 },
      } as never);

      expect(mockOpenClaw.executeAgent).not.toHaveBeenCalled();
    });
  });
});
