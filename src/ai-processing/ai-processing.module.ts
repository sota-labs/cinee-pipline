import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AiProcessingService } from './ai-processing.service';
import { AiProcessingProcessor } from './ai-processing.processor';
import { KolModule } from '../kol/kol.module';
import { BULL_QUEUES } from '../common/constants/kol.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: BULL_QUEUES.AI_PIPELINE },
      { name: BULL_QUEUES.TELEGRAM_APPROVAL },
      { name: BULL_QUEUES.ENGAGEMENT },
    ),
    KolModule,
  ],
  providers: [AiProcessingService, AiProcessingProcessor],
  exports: [AiProcessingService],
})
export class AiProcessingModule {}
