import { Module } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import { BullModule } from '@nestjs/bull';
import { TelegramService } from './telegram.service';
import { TelegramUpdate } from './telegram.update';
import { TelegramApprovalProcessor } from './telegram-approval.processor';
import { BULL_QUEUES } from '../common/constants/kol.constants';

@Module({
  imports: [
    TelegrafModule.forRoot({
      token: process.env.TELEGRAM_BOT_TOKEN ?? '',
    }),
    BullModule.registerQueue(
      { name: BULL_QUEUES.TELEGRAM_APPROVAL },
      { name: BULL_QUEUES.ENGAGEMENT },
      { name: BULL_QUEUES.AI_PIPELINE },
    ),
  ],
  providers: [TelegramService, TelegramUpdate, TelegramApprovalProcessor],
  exports: [TelegramService],
})
export class TelegramModule {}
