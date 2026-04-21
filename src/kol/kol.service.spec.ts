import { Test } from '@nestjs/testing';
import { KolService } from './kol.service';
import { PrismaService } from '../prisma/prisma.service';
import { getQueueToken } from '@nestjs/bull';
import { BULL_QUEUES } from '../common/constants/kol.constants';
import { ConflictException, NotFoundException } from '@nestjs/common';

const mockPrisma = {
  kol: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  kolPost: { count: jest.fn() },
};

const mockQueue = {
  add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  getJobs: jest.fn().mockResolvedValue([]),
};

describe('KolService', () => {
  let service: KolService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        KolService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken(BULL_QUEUES.KOL_CRAWL), useValue: mockQueue },
      ],
    }).compile();
    service = module.get(KolService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('strips @ from handle and lowercases', async () => {
      mockPrisma.kol.findUnique.mockResolvedValue(null);
      mockPrisma.kol.create.mockResolvedValue({ id: 'k1', handle: 'alice', isActive: true });
      mockQueue.getJobs.mockResolvedValue([]);
      mockQueue.add.mockResolvedValue({ id: 'job-1' });
      await service.create({ handle: '@Alice', platform: 'x' });
      expect(mockPrisma.kol.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ handle: 'alice' }) }),
      );
    });

    it('throws ConflictException if KOL already exists', async () => {
      mockPrisma.kol.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.create({ handle: 'alice', platform: 'x' })).rejects.toThrow(ConflictException);
    });

    it('auto-enqueues style-learn when isActive', async () => {
      mockPrisma.kol.findUnique.mockResolvedValue(null);
      mockPrisma.kol.create.mockResolvedValue({ id: 'k1', handle: 'alice', isActive: true });
      mockQueue.getJobs.mockResolvedValue([]);
      mockQueue.add.mockResolvedValue({ id: 'job-1' });
      await service.create({ handle: 'alice', isActive: true });
      expect(mockQueue.add).toHaveBeenCalledWith('style-learn', { kolId: 'k1' }, expect.any(Object));
    });

    it('does NOT enqueue style-learn when isActive is false', async () => {
      mockPrisma.kol.findUnique.mockResolvedValue(null);
      mockPrisma.kol.create.mockResolvedValue({ id: 'k1', handle: 'alice', isActive: false });
      await service.create({ handle: 'alice', isActive: false });
      expect(mockQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('shouldTriggerStyleLearn', () => {
    it('returns true on first-ever learn (no styleLastLearnedAt)', () => {
      expect(service.shouldTriggerStyleLearn({ styleLastLearnedAt: null, stylePostCountAtLastLearn: 0 }, 5)).toBe(true);
    });

    it('returns true when 10+ new posts since last learn', () => {
      const kol = { styleLastLearnedAt: new Date(), stylePostCountAtLastLearn: 20 };
      expect(service.shouldTriggerStyleLearn(kol, 30)).toBe(true);
    });

    it('returns false when fewer than 10 new posts', () => {
      const kol = { styleLastLearnedAt: new Date(), stylePostCountAtLastLearn: 25 };
      expect(service.shouldTriggerStyleLearn(kol, 29)).toBe(false);
    });
  });

  describe('enqueueStyleLearn', () => {
    it('skips if job already in queue (idempotent)', async () => {
      mockQueue.getJobs.mockResolvedValue([{ name: 'style-learn', data: { kolId: 'k1' } }]);
      const result = await service.enqueueStyleLearn('k1', false);
      expect(result).toEqual({ skipped: true });
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('enqueues when force=true even if already queued', async () => {
      mockQueue.getJobs.mockResolvedValue([{ name: 'style-learn', data: { kolId: 'k1' } }]);
      mockQueue.add.mockResolvedValue({ id: 'job-2' });
      await service.enqueueStyleLearn('k1', true);
      expect(mockQueue.add).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws NotFoundException for unknown id', async () => {
      mockPrisma.kol.findUnique.mockResolvedValue(null);
      await expect(service.remove('bad-id')).rejects.toThrow(NotFoundException);
    });
  });
});
