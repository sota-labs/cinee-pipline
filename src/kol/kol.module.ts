import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { KolController } from './kol.controller';
import { KolService } from './kol.service';
import { KolStyleService } from './kol-style.service';
import { BULL_QUEUES } from '../common/constants/kol.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: BULL_QUEUES.KOL_CRAWL }),
  ],
  controllers: [KolController],
  providers: [KolService, KolStyleService],
  exports: [KolService, KolStyleService],
})
export class KolModule {}
