import { Test } from '@nestjs/testing';
import { EngagementService } from './engagement.service';
import { PrismaService } from '../prisma/prisma.service';
import { getQueueToken } from '@nestjs/bull';
import { BULL_QUEUES, KOL_CONSTANTS } from '../common/constants/kol.constants';

const mockPrisma = {
  pendingComment: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const mockQueue = { add: jest.fn().mockResolvedValue({ id: 'j1' }) };

describe('EngagementService', () => {
  let service: EngagementService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EngagementService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken(BULL_QUEUES.ENGAGEMENT), useValue: mockQueue },
      ],
    }).compile();
    service = module.get(EngagementService);
    jest.clearAllMocks();
  });

  describe('scheduleVisibilityCheck', () => {
    it('schedules next check with correct jobId and delay', async () => {
      await service.scheduleVisibilityCheck('c1', 0);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'visibility-check',
        { commentId: 'c1', checkIndex: 1 },
        expect.objectContaining({
          delay: KOL_CONSTANTS.VISIBILITY_CHECK_INTERVAL_MS,
          jobId: 'vis-c1-1',
        }),
      );
    });

    it('does not schedule beyond VISIBILITY_CHECK_COUNT', async () => {
      await service.scheduleVisibilityCheck('c1', KOL_CONSTANTS.VISIBILITY_CHECK_COUNT);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('recordVisibilityResult', () => {
    beforeEach(() => {
      mockPrisma.pendingComment.findUnique.mockResolvedValue({ id: 'c1', status: 'APPROVED' });
    });

    it('sets status POSTED when visible', async () => {
      await service.recordVisibilityResult('c1', {
        status: 'visible',
        checkIndex: 1,
        checkedAt: new Date(),
      });
      expect(mockPrisma.pendingComment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'POSTED' }) }),
      );
    });

    it('sets status FAILED when flagged', async () => {
      await service.recordVisibilityResult('c1', {
        status: 'flagged',
        checkIndex: 1,
        checkedAt: new Date(),
      });
      expect(mockPrisma.pendingComment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
      );
    });

    it('schedules next check when status is unknown and checks remain', async () => {
      await service.recordVisibilityResult('c1', {
        status: 'unknown',
        checkIndex: 1,
        checkedAt: new Date(),
      });
      expect(mockQueue.add).toHaveBeenCalled();
      expect(mockPrisma.pendingComment.update).not.toHaveBeenCalled();
    });

    it('finalizes POSTED after exhausting all checks with unknown status', async () => {
      await service.recordVisibilityResult('c1', {
        status: 'unknown',
        checkIndex: KOL_CONSTANTS.VISIBILITY_CHECK_COUNT,
        checkedAt: new Date(),
      });
      expect(mockPrisma.pendingComment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'POSTED' }) }),
      );
    });

    it('returns early when comment not found', async () => {
      mockPrisma.pendingComment.findUnique.mockResolvedValue(null);
      await service.recordVisibilityResult('missing', {
        status: 'visible',
        checkIndex: 1,
        checkedAt: new Date(),
      });
      expect(mockPrisma.pendingComment.update).not.toHaveBeenCalled();
    });
  });

  describe('computeRandomDelay', () => {
    it('returns value within [min, max] ms range', () => {
      for (let i = 0; i < 100; i++) {
        const delay = service.computeRandomDelay(1, 3);
        expect(delay).toBeGreaterThanOrEqual(60_000);
        expect(delay).toBeLessThanOrEqual(180_000);
      }
    });
  });
});
