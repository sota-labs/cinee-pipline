import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { EngagementService } from './engagement.service';
import { EngagementProcessor } from './engagement.processor';
import { OpenClawModule } from '../openclaw/openclaw.module';
import { TelegramModule } from '../telegram/telegram.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BULL_QUEUES } from '../common/constants/kol.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: BULL_QUEUES.ENGAGEMENT }),
    OpenClawModule,
    TelegramModule,
    PrismaModule,
  ],
  providers: [EngagementService, EngagementProcessor],
  exports: [EngagementService],
})
export class EngagementModule {}
