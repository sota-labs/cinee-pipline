import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { KOL_CONSTANTS, BULL_QUEUES } from '../common/constants/kol.constants';
import { CreateKolDto } from './dto/create-kol.dto';
import { UpdateKolDto } from './dto/update-kol.dto';

@Injectable()
export class KolService {
  private readonly logger = new Logger(KolService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(BULL_QUEUES.KOL_CRAWL) private readonly crawlQueue: Queue,
  ) {}

  async create(dto: CreateKolDto) {
    const handle = dto.handle.replace(/^@/, '').toLowerCase();
    const platform = dto.platform ?? 'x';

    const existing = await this.prisma.kol.findUnique({
      where: { platform_handle: { platform, handle } },
    });
    if (existing) throw new ConflictException(`KOL @${handle} on ${platform} already exists`);

    const kol = await this.prisma.kol.create({
      data: { ...dto, handle, platform },
    });

    if (kol.isActive) {
      await this.enqueueStyleLearn(kol.id, false);
    }

    return kol;
  }

  async findAll(filters: { platform?: string; isActive?: boolean; q?: string; limit?: number; skip?: number }) {
    const { platform, isActive, q, limit = 20, skip = 0 } = filters;
    const where: Record<string, unknown> = {};
    if (platform) where.platform = platform;
    if (isActive !== undefined) where.isActive = isActive;
    if (q) where.handle = { contains: q, mode: 'insensitive' };

    const [kols, total] = await Promise.all([
      this.prisma.kol.findMany({ where, take: limit, skip, orderBy: { createdAt: 'desc' } }),
      this.prisma.kol.count({ where }),
    ]);
    return { data: kols, total, limit, skip };
  }

  async findOne(id: string) {
    const kol = await this.prisma.kol.findUnique({ where: { id } });
    if (!kol) throw new NotFoundException(`KOL ${id} not found`);
    return kol;
  }

  async update(id: string, dto: UpdateKolDto) {
    await this.findOne(id);
    if (dto.handle) dto.handle = dto.handle.replace(/^@/, '').toLowerCase();
    return this.prisma.kol.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.kol.delete({ where: { id } });
    return { success: true };
  }

  async getStats(id: string) {
    const kol = await this.findOne(id);
    const [totalPosts, pendingPosts] = await Promise.all([
      this.prisma.kolPost.count({ where: { kolId: id } }),
      this.prisma.kolPost.count({ where: { kolId: id, status: 'NEW' } }),
    ]);
    return {
      kol,
      stats: {
        totalPosts,
        pendingPosts,
        lastCrawledAt: kol.lastCrawledAt,
        styleLastLearnedAt: kol.styleLastLearnedAt,
        writingSamplesCount: kol.writingSamples.length,
      },
    };
  }

  async enqueueStyleLearn(kolId: string, force: boolean): Promise<{ jobId: string | number } | { skipped: true }> {
    // Idempotent: don't double-queue if a learn job is already waiting
    if (!force) {
      const waiting = await this.crawlQueue.getJobs(['waiting', 'delayed', 'active']);
      const alreadyQueued = waiting.some(
        (j) => j.name === 'style-learn' && j.data?.kolId === kolId,
      );
      if (alreadyQueued) {
        this.logger.log(`Style learn already queued for KOL ${kolId}, skipping`);
        return { skipped: true };
      }
    }

    const job = await this.crawlQueue.add('style-learn', { kolId }, { attempts: 2, backoff: 30_000 });
    this.logger.log(`Enqueued style-learn for KOL ${kolId}, job ${job.id}`);
    return { jobId: job.id };
  }

  shouldTriggerStyleLearn(
    kol: { styleLastLearnedAt: Date | null; stylePostCountAtLastLearn: number },
    newPostCount: number,
  ): boolean {
    if (!kol.styleLastLearnedAt) return true; // first-ever learn
    const delta = newPostCount - kol.stylePostCountAtLastLearn;
    return delta >= KOL_CONSTANTS.MIN_SAMPLES_FOR_STYLE_LEARN;
  }

  async getActiveKols() {
    return this.prisma.kol.findMany({ where: { isActive: true }, orderBy: { lastCrawledAt: 'asc' } });
  }

  async markCrawled(id: string) {
    return this.prisma.kol.update({ where: { id }, data: { lastCrawledAt: new Date() } });
  }

  async appendWritingSamples(id: string, samples: string[]) {
    const kol = await this.findOne(id);
    const merged = [...kol.writingSamples, ...samples].slice(-KOL_CONSTANTS.MAX_WRITING_SAMPLES);
    return this.prisma.kol.update({ where: { id }, data: { writingSamples: merged } });
  }
}
