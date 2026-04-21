import { Test } from '@nestjs/testing';
import { CrawlerService } from './crawler.service';
import { KolDbService } from '../kol/kol-db.service';
import { getQueueToken } from '@nestjs/bull';
import { BULL_QUEUES } from '../common/constants/kol.constants';

const mockKolDb = {
  findKolsDueForCrawl: jest.fn(),
  findKolById: jest.fn(),
};

const mockQueue = {
  add: jest.fn().mockResolvedValue({ id: 'job-1' }),
};

describe('CrawlerService', () => {
  let service: CrawlerService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        CrawlerService,
        { provide: KolDbService, useValue: mockKolDb },
        { provide: getQueueToken(BULL_QUEUES.KOL_CRAWL), useValue: mockQueue },
      ],
    }).compile();
    service = module.get(CrawlerService);
    jest.clearAllMocks();
  });

  describe('scheduleCrawl', () => {
    it('does nothing when no KOLs are due', async () => {
      mockKolDb.findKolsDueForCrawl.mockResolvedValue([]);
      await service.scheduleCrawl();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('dispatches one batch for <= 10 KOLs with no delay', async () => {
      const kols = Array.from({ length: 5 }, (_, i) => ({
        id: `k${i}`,
        handle: `user${i}`,
        platform: 'x',
        profileUrl: '',
        lastCrawledAt: null,
      }));
      mockKolDb.findKolsDueForCrawl.mockResolvedValue(kols);
      await service.scheduleCrawl();
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'crawl-batch',
        { kols },
        expect.objectContaining({ delay: 0 }),
      );
    });

    it('dispatches multiple batches for > 10 KOLs with staggered delays', async () => {
      const kols = Array.from({ length: 25 }, (_, i) => ({
        id: `k${i}`,
        handle: `user${i}`,
        platform: 'x',
        profileUrl: '',
        lastCrawledAt: null,
      }));
      mockKolDb.findKolsDueForCrawl.mockResolvedValue(kols);
      await service.scheduleCrawl();
      expect(mockQueue.add).toHaveBeenCalledTimes(3); // batches of 10: 10+10+5
      const calls = mockQueue.add.mock.calls;
      expect(calls[0][2].delay).toBe(0);
      expect(calls[1][2].delay).toBe(2 * 60 * 1000);
      expect(calls[2][2].delay).toBe(4 * 60 * 1000);
    });
  });

  describe('triggerManualCrawl', () => {
    it('queues a single KOL when kolId is provided', async () => {
      const kol = { id: 'k1', handle: 'alice', platform: 'x', profileUrl: '', lastCrawledAt: null };
      mockKolDb.findKolById.mockResolvedValue(kol);
      const result = await service.triggerManualCrawl('k1');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'crawl-batch',
        { kols: [kol] },
        expect.objectContaining({ attempts: 2 }),
      );
      expect(result).toEqual({ queued: 1 });
    });

    it('throws when kolId not found', async () => {
      mockKolDb.findKolById.mockResolvedValue(null);
      await expect(service.triggerManualCrawl('bad-id')).rejects.toThrow('KOL bad-id not found');
    });

    it('triggers full scheduleCrawl when no kolId given', async () => {
      mockKolDb.findKolsDueForCrawl.mockResolvedValue([]);
      const result = await service.triggerManualCrawl();
      expect(result).toEqual({ triggered: true });
    });
  });
});
