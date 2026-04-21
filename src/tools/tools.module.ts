import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ToolsController } from './tools.controller';
import { ToolsService } from './tools.service';
import { PrismaModule } from '../prisma/prisma.module';
import { BULL_QUEUES } from '../common/constants/kol.constants';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue(
      { name: BULL_QUEUES.KOL_CRAWL },
      { name: BULL_QUEUES.AI_PIPELINE },
      { name: BULL_QUEUES.ENGAGEMENT },
    ),
  ],
  controllers: [ToolsController],
  providers: [ToolsService],
  exports: [ToolsService],
})
export class ToolsModule {}
