import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { OpenClawService } from '../openclaw/openclaw.service';
import { markKolCrawled, findKolById, updateManyKols, analyzeKolStyle, updateKol, storeKolEmbedding } from '../services/kolService.js';
import { createKolPost } from '../services/kolPostService.js';
import { BULL_QUEUES, getApiUrl } from '../common/constants/kol.constants';
import { buildKolCrawlPrompt, buildKolStyleLearnPrompt } from '../prompts/kol-prompts';

interface KolBasic {
  id: string;
  handle: string;
  platform: string;
  profileUrl: string;
}

interface CrawlBatchJob {
  kols: KolBasic[];
}

interface StyleLearnJob {
  kolId: string;
}

@Processor(BULL_QUEUES.KOL_CRAWL)
export class CrawlerProcessor {
  private readonly logger = new Logger(CrawlerProcessor.name);

  constructor(
    private readonly openclaw: OpenClawService,
  ) {}

  @Process('crawl-batch')
  async handleCrawlBatch(job: Job<CrawlBatchJob>): Promise<void> {
    const { kols } = job.data;
    const apiUrl = getApiUrl();
    this.logger.log(`Processing crawl-batch: ${kols.map((k) => k.handle).join(', ')}`);

    const prompt = buildKolCrawlPrompt(kols, apiUrl);
    await this.openclaw.executeAgent(prompt);

    // Update lastCrawledAt for all KOLs in this batch
    await updateManyKols(
      kols.map((k) => k.id),
      { lastCrawledAt: new Date() }
    );
  }

  @Process('style-learn')
  async handleStyleLearn(job: Job<StyleLearnJob>): Promise<void> {
    const { kolId } = job.data;
    this.logger.log(`Running style learn for KOL ${kolId}`);
    const apiUrl = getApiUrl();

    const kol = await findKolById(kolId);
    if (!kol) {
      this.logger.warn(`KOL ${kolId} not found — skipping style learn`);
      return;
    }

    if (kol.writingSamples.length < 3) {
      this.logger.log(
        `KOL ${kolId} has < 3 writing samples — triggering OpenClaw to scrape profile first`,
      );
      const prompt = buildKolStyleLearnPrompt(kol, apiUrl);
      await this.openclaw.executeAgent(prompt);
      return;
    }

    // Have samples — run local OpenAI analysis
    const result = await analyzeKolStyle(kolId, kol.writingSamples);
    await updateKol(kolId, {
      styleSummary: result.style_summary,
      personalityNotes: result.personality_notes,
      slangVocab: result.slang_vocab,
      styleLastLearnedAt: new Date(),
      stylePostCountAtLastLearn: kol.writingSamples.length,
    });

    // Store embeddings for few-shot retrieval
    for (const sample of kol.writingSamples.slice(-20)) {
      await storeKolEmbedding(kolId, sample, new Date());
    }

    this.logger.log(`Style learn complete for KOL ${kolId}`);
  }
}
