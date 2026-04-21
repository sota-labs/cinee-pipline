import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import { findKolById, updateKolStyle, analyzeKolStyle, findSimilarKolExamples, appendWritingSamples } from '../services/kolService.js';
import { findKolPostById, updateKolPost, findKolPostProcessing, upsertKolPostProcessing, createPendingComment, updatePendingComment } from '../services/kolPostService.js';
import { AiProcessingService, TopComment } from './ai-processing.service';
import { BULL_QUEUES, KOL_CONSTANTS } from '../common/constants/kol.constants';
import Redis from 'ioredis';

interface ProcessPostJob {
  kolPostId: string;
  kolId: string;
}

@Processor(BULL_QUEUES.AI_PIPELINE)
export class AiProcessingProcessor {
  private readonly logger = new Logger(AiProcessingProcessor.name);
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

  constructor(
    private readonly aiService: AiProcessingService,
    @InjectQueue(BULL_QUEUES.TELEGRAM_APPROVAL) private readonly telegramQueue: Queue,
    @InjectQueue(BULL_QUEUES.ENGAGEMENT) private readonly engagementQueue: Queue,
  ) {}

  @Process('process-post')
  async handleProcessPost(job: Job<ProcessPostJob>): Promise<void> {
    const { kolPostId, kolId } = job.data;
    this.logger.log(`Processing post ${kolPostId}`);

    // Mark post as processing
    await updateKolPost(kolPostId, { status: 'PROCESSING' });

    const [kolPost, kol] = await Promise.all([
      findKolPostById(kolPostId),
      findKolById(kolId),
    ]);

    if (!kolPost || !kol) {
      this.logger.warn(`Post ${kolPostId} or KOL ${kolId} not found`);
      return;
    }

    // Get top comments from processing record if they exist (scraped by OpenClaw callback)
    const existingProcessing = await findKolPostProcessing(kolPostId);

    const topComments: TopComment[] = existingProcessing
      ? (existingProcessing.topComments as unknown as TopComment[])
      : [];

    // Run the 3-step pipeline
    const result = await this.aiService.runPipeline(kolPost.content, topComments, {
      id: kol.id,
      styleSummary: kol.styleSummary,
      personalityNotes: kol.personalityNotes,
      slangVocab: kol.slangVocab,
    });

    // Save processing result
    await upsertKolPostProcessing(kolPostId, {
      summary: result.summary,
      topComments: topComments as object[],
      sentimentJson: result.sentiment as object,
      trendSummary: result.sentiment.trend_summary,
    });

    // Save all 3 candidates as PendingComment records
    const savedComments: { id: string }[] = [];
    for (let i = 0; i < result.candidates.length; i++) {
      const c = result.candidates[i];
      const updatedPost = await createPendingComment(kolPostId, {
        kolPostId,
        kolId,
        content: c.content,
        alignment: c.alignment,
        rationale: c.rationale,
        candidateIndex: i,
        status: 'PENDING_REVIEW',
        isAutoSelected: false,
      });
      if (updatedPost?.pendingComments) {
        const newComment = updatedPost.pendingComments[updatedPost.pendingComments.length - 1];
        savedComments.push({ id: newComment._id!.toString() });
      }
    }

    // Mark post as processed
    await updateKolPost(kolPostId, { status: 'PROCESSED' });

    // Check mode from Redis
    const mode = (await this.redis.get('bot:mode')) ?? 'manual';

    if (mode === 'afk') {
      const best = this.aiService.selectAfkCandidate(result.candidates, result.sentiment);
      const bestRecord = savedComments[result.candidates.indexOf(best)];

      await updatePendingComment(bestRecord.id, { status: 'AUTO_SELECTED', isAutoSelected: true });

      // Random delay 1-3 min before posting (anti-ban)
      const delayMs = this.randomDelay(
        KOL_CONSTANTS.DEFAULT_REPLY_RATE_LIMIT_MIN,
        KOL_CONSTANTS.DEFAULT_REPLY_RATE_LIMIT_MAX,
      );

      await this.engagementQueue.add(
        'post-comment',
        { pendingCommentId: bestRecord.id, kolPostId, postUrl: kolPost.postUrl },
        { delay: delayMs, attempts: 2, backoff: 60_000 },
      );

      this.logger.log(
        `AFK: auto-selected candidate ${bestRecord.id} (${best.alignment}), posting in ${Math.round(delayMs / 1000)}s`,
      );
    } else {
      // Manual mode: send all candidates to Telegram for review
      await this.telegramQueue.add(
        'send-approval',
        {
          kolPostId,
          kolId,
          kolHandle: kol.handle,
          postContent: kolPost.content,
          postUrl: kolPost.postUrl,
          summary: result.summary,
          sentiment: result.sentiment,
          candidates: savedComments.map((c) => ({
            id: c.id,
            content: c.content,
            alignment: c.alignment,
          })),
        },
        { attempts: 2 },
      );

      this.logger.log(
        `Manual: sent ${savedComments.length} candidates to Telegram for KOL @${kol.handle}`,
      );
    }
  }

  private randomDelay(minMinutes: number, maxMinutes: number): number {
    const minMs = minMinutes * 60 * 1000;
    const maxMs = maxMinutes * 60 * 1000;
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  }
}
