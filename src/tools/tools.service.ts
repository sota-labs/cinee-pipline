import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../prisma/prisma.service';
import { KOL_CONSTANTS, BULL_QUEUES } from '../common/constants/kol.constants';
import { TopComment } from '../ai-processing/ai-processing.service';

interface IngestedPost {
  post_url: string;
  external_post_id: string;
  content: string;
  likes?: number;
  comments?: number;
  shares?: number;
  posted_at: string;
}

interface IngestPostsBody {
  posts: IngestedPost[];
}

@Injectable()
export class ToolsService {
  private readonly logger = new Logger(ToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(BULL_QUEUES.KOL_CRAWL) private readonly crawlQueue: Queue,
    @InjectQueue(BULL_QUEUES.AI_PIPELINE) private readonly aiQueue: Queue,
    @InjectQueue(BULL_QUEUES.ENGAGEMENT) private readonly engagementQueue: Queue,
  ) {}

  async ingestStyleLearnResult(kolId: string, body: unknown) {
    this.logger.log(`Style learn result for KOL ${kolId}`);
    const { style_summary, personality_notes, slang_vocab, writing_samples } = body as {
      style_summary?: string;
      personality_notes?: string;
      slang_vocab?: string[];
      writing_samples?: string[];
    };

    await this.prisma.kol.update({
      where: { id: kolId },
      data: {
        ...(style_summary && { styleSummary: style_summary }),
        ...(personality_notes && { personalityNotes: personality_notes }),
        ...(slang_vocab && { slangVocab: slang_vocab }),
        styleLastLearnedAt: new Date(),
      },
    });

    if (writing_samples?.length) {
      const kol = await this.prisma.kol.findUnique({
        where: { id: kolId },
        select: { writingSamples: true },
      });
      const merged = [...(kol?.writingSamples ?? []), ...writing_samples].slice(-50);
      await this.prisma.kol.update({ where: { id: kolId }, data: { writingSamples: merged } });
    }

    return { success: true };
  }

  async getCrawlTargets(limit: number, offset: number) {
    const kols = await this.prisma.kol.findMany({
      where: { isActive: true },
      select: { id: true, handle: true, platform: true, lastCrawledAt: true, profileUrl: true },
      take: limit,
      skip: offset,
      orderBy: { lastCrawledAt: 'asc' },
    });
    return { success: true, data: kols };
  }

  async ingestCrawledPosts(kolId: string, body: unknown) {
    this.logger.log(`Crawled posts ingest for KOL ${kolId}`);
    const { posts } = body as IngestPostsBody;

    if (!posts?.length) return { success: true, created: 0, duplicates: 0 };

    let created = 0;
    let duplicates = 0;

    for (const p of posts) {
      const engagementScore =
        (p.likes ?? 0) * KOL_CONSTANTS.ENGAGEMENT_WEIGHTS.like +
        (p.comments ?? 0) * KOL_CONSTANTS.ENGAGEMENT_WEIGHTS.reply +
        (p.shares ?? 0) * KOL_CONSTANTS.ENGAGEMENT_WEIGHTS.share;

      try {
        const kolPost = await this.prisma.kolPost.create({
          data: {
            kolId,
            postUrl: p.post_url,
            externalPostId: p.external_post_id,
            content: p.content,
            likes: p.likes ?? 0,
            comments: p.comments ?? 0,
            shares: p.shares ?? 0,
            engagementScore,
            postedAt: new Date(p.posted_at),
            status: 'NEW',
          },
        });
        created++;
        // Trigger AI processing pipeline for each new post
        await this.aiQueue.add(
          'process-post',
          { kolPostId: kolPost.id, kolId },
          { attempts: 2, backoff: 30_000 },
        );
      } catch (e: unknown) {
        if ((e as { code?: string }).code === 'P2002') {
          duplicates++; // unique constraint on postUrl
        } else {
          throw e;
        }
      }
    }

    // Check if we should re-run style learning
    const kol = await this.prisma.kol.findUnique({
      where: { id: kolId },
      select: {
        writingSamples: true,
        styleLastLearnedAt: true,
        stylePostCountAtLastLearn: true,
      },
    });

    if (kol) {
      const newPostCount = await this.prisma.kolPost.count({ where: { kolId } });
      const shouldLearn =
        !kol.styleLastLearnedAt ||
        newPostCount - kol.stylePostCountAtLastLearn >= KOL_CONSTANTS.MIN_SAMPLES_FOR_STYLE_LEARN;

      if (shouldLearn) {
        const waiting = await this.crawlQueue.getJobs(['waiting', 'delayed', 'active']);
        const alreadyQueued = waiting.some(
          (j) => j.name === 'style-learn' && j.data?.kolId === kolId,
        );
        if (!alreadyQueued) {
          await this.crawlQueue.add('style-learn', { kolId }, { attempts: 2 });
        }
      }
    }

    this.logger.log(`Ingested ${created} new posts, ${duplicates} duplicates for KOL ${kolId}`);
    return { success: true, created, duplicates };
  }

  async ingestProcessingResult(kolPostId: string, body: unknown) {
    this.logger.log(`Processing result for post ${kolPostId}`);
    const { top_comments } = body as { top_comments?: TopComment[] };

    if (top_comments?.length) {
      await this.prisma.kolPostProcessing.upsert({
        where: { kolPostId },
        create: {
          kolPostId,
          topComments: top_comments as object[],
          sentimentJson: {},
          trendSummary: '',
        },
        update: { topComments: top_comments as object[] },
      });
    }

    // Re-trigger AI pipeline now that comments are available
    const kolPost = await this.prisma.kolPost.findUnique({
      where: { id: kolPostId },
      select: { kolId: true, status: true },
    });

    if (kolPost && kolPost.status !== 'PROCESSED') {
      await this.aiQueue.add(
        'process-post',
        { kolPostId, kolId: kolPost.kolId },
        { attempts: 2, backoff: 30_000 },
      );
    }

    return { success: true };
  }

  async ingestCommentPosted(commentId: string, body: unknown) {
    this.logger.log(`Comment posted callback: ${commentId}`);
    const { posted_url, success } = body as { posted_url?: string; success?: boolean };

    if (!success || !posted_url) {
      this.logger.warn(
        `Comment ${commentId} post callback: success=${success}, url=${posted_url}`,
      );
      await this.prisma.pendingComment.update({
        where: { id: commentId },
        data: { status: 'FAILED' as never },
      });
      return { success: false };
    }

    await this.prisma.pendingComment.update({
      where: { id: commentId },
      data: { postedAt: new Date(), postedUrl: posted_url },
      // status stays APPROVED/AUTO_SELECTED until visibility confirmed
    });

    // Schedule first visibility check in 5 min
    await this.engagementQueue.add(
      'visibility-check',
      { commentId, checkIndex: 1 },
      {
        delay: KOL_CONSTANTS.VISIBILITY_CHECK_INTERVAL_MS,
        jobId: `vis-${commentId}-1`,
        attempts: 2,
      },
    );

    this.logger.log(`Comment ${commentId} posted at ${posted_url}`);
    return { success: true };
  }

  async ingestVisibilityResult(commentId: string, body: unknown) {
    const { status, check_index } = body as {
      status: 'visible' | 'collapsed' | 'flagged' | 'unknown';
      check_index: number;
      notes?: string;
    };

    let finalStatus: string | undefined;
    if (status === 'visible') {
      finalStatus = 'POSTED';
    } else if (status === 'flagged') {
      finalStatus = 'FAILED';
    } else if (status === 'collapsed') {
      finalStatus = 'POSTED';
    } else if (check_index >= KOL_CONSTANTS.VISIBILITY_CHECK_COUNT) {
      finalStatus = 'POSTED'; // exhausted checks, assume posted
    }

    if (finalStatus) {
      await this.prisma.pendingComment.update({
        where: { id: commentId },
        data: { status: finalStatus as never },
      });
      this.logger.log(
        `Comment ${commentId} finalized: ${finalStatus} (visibility: ${status})`,
      );
    } else {
      // Schedule next check
      const nextCheck = check_index + 1;
      if (nextCheck <= KOL_CONSTANTS.VISIBILITY_CHECK_COUNT) {
        await this.engagementQueue.add(
          'visibility-check',
          { commentId, checkIndex: nextCheck },
          {
            delay: KOL_CONSTANTS.VISIBILITY_CHECK_INTERVAL_MS,
            jobId: `vis-${commentId}-${nextCheck}`,
            attempts: 2,
          },
        );
      }
    }

    return { success: true };
  }
}
