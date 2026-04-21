import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { findActiveKols, findKolsDueForCrawl, findKolById, markKolCrawled } from '../services/kolService.js';
import { KOL_CONSTANTS, BULL_QUEUES } from '../common/constants/kol.constants';

@Injectable()
export class CrawlerService {
  private readonly logger = new Logger(CrawlerService.name);
  private readonly batchSize = KOL_CONSTANTS.CRAWL_BATCH_SIZE_DEFAULT;

  constructor(
    @InjectQueue(BULL_QUEUES.KOL_CRAWL) private readonly crawlQueue: Queue,
  ) {}

  // Fires every 45 minutes
  @Cron('0 */45 * * * *')
  async scheduleCrawl(): Promise<void> {
    this.logger.log('Crawl cron triggered');
    const cadenceMs = KOL_CONSTANTS.DEFAULT_CRAWL_CADENCE_MIN * 60 * 1000;
    const cutoff = new Date(Date.now() - cadenceMs);

    const kols = await findKolsDueForCrawl(cutoff);

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
      const kol = await findKolById(kolId);
      if (!kol) throw new Error(`KOL ${kolId} not found`);
      const kolBasic = {
        id: kol._id!.toString(),
        handle: kol.handle,
        platform: kol.platform,
        profileUrl: kol.profileUrl,
        lastCrawledAt: kol.lastCrawledAt,
      };
      await this.crawlQueue.add('crawl-batch', { kols: [kolBasic] }, { attempts: 2 });
      return { queued: 1 };
    }
    await this.scheduleCrawl();
    return { triggered: true };
  }
}
