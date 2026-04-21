import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { OpenClawModule } from './openclaw/openclaw.module';
import { ToolsModule } from './tools/tools.module';
import { KolModule } from './kol/kol.module';
import { CrawlerModule } from './crawler/crawler.module';
import { AiProcessingModule } from './ai-processing/ai-processing.module';
import { TelegramModule } from './telegram/telegram.module';
import { EngagementModule } from './engagement/engagement.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        redis: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
      }),
    }),
    OpenClawModule,
    ToolsModule,
    KolModule,
    CrawlerModule,
    AiProcessingModule,
    TelegramModule,
    EngagementModule,
  ],
})
export class AppModule {}
