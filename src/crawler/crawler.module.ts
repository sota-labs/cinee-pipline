import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { CrawlerService } from './crawler.service';
import { CrawlerProcessor } from './crawler.processor';
import { KolModule } from '../kol/kol.module';
import { OpenClawModule } from '../openclaw/openclaw.module';
import { BULL_QUEUES } from '../common/constants/kol.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: BULL_QUEUES.KOL_CRAWL },
      { name: BULL_QUEUES.AI_PIPELINE },
    ),
    KolModule,
    OpenClawModule,
  ],
  providers: [CrawlerService, CrawlerProcessor],
  exports: [CrawlerService],
})
export class CrawlerModule {}
