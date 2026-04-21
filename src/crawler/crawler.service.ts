import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { KOL_CONSTANTS, BULL_QUEUES } from '../common/constants/kol.constants';

@Injectable()
export class CrawlerService {
  private readonly logger = new Logger(CrawlerService.name);
  private readonly batchSize = KOL_CONSTANTS.CRAWL_BATCH_SIZE_DEFAULT;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(BULL_QUEUES.KOL_CRAWL) private readonly crawlQueue: Queue,
  ) {}

  // Fires every 45 minutes
  @Cron('0 */45 * * * *')
  async scheduleCrawl(): Promise<void> {
    this.logger.log('Crawl cron triggered');
    const cadenceMs = KOL_CONSTANTS.DEFAULT_CRAWL_CADENCE_MIN * 60 * 1000;
    const cutoff = new Date(Date.now() - cadenceMs);

    const kols = await this.prisma.kol.findMany({
      where: {
        isActive: true,
        OR: [{ lastCrawledAt: null }, { lastCrawledAt: { lt: cutoff } }],
      },
      select: { id: true, handle: true, platform: true, profileUrl: true, lastCrawledAt: true },
      orderBy: { lastCrawledAt: 'asc' },
    });

    if (!kols.length) {
      this.logger.log('No KOLs due for crawl');
      return;
    }

    this.logger.log(
      `${kols.length} KOLs due for crawl — dispatching in batches of ${this.batchSize}`,
    );

    for (let offset = 0; offset < kols.length; offset += this.batchSize) {
      const batch = kols.slice(offset, offset + this.batchSize);
      // Stagger batches by 2 min each to avoid hammering OpenClaw
      const delayMs = Math.floor(offset / this.batchSize) * 2 * 60 * 1000;
      await this.crawlQueue.add(
        'crawl-batch',
        { kols: batch },
        { delay: delayMs, attempts: 2, backoff: 60_000 },
      );
    }
  }

  async triggerManualCrawl(kolId?: string): Promise<{ queued: number } | { triggered: boolean }> {
    if (kolId) {
      const kol = await this.prisma.kol.findUnique({
        where: { id: kolId },
        select: { id: true, handle: true, platform: true, profileUrl: true, lastCrawledAt: true },
      });
      if (!kol) throw new Error(`KOL ${kolId} not found`);
      await this.crawlQueue.add('crawl-batch', { kols: [kol] }, { attempts: 2 });
      return { queued: 1 };
    }
    await this.scheduleCrawl();
    return { triggered: true };
  }
}
