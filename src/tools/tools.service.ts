import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { findKols, updateKol, findKolById, appendWritingSamples, MIN_SAMPLES_FOR_STYLE_LEARN } from '../services/kolService.js';
import { createKolPost, countKolPosts, upsertKolPostProcessing, updatePendingComment, findKolPostById, countKolPostsByKolId } from '../services/kolPostService.js';
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

    const updateData: Record<string, unknown> = { styleLastLearnedAt: new Date() };
    if (style_summary) updateData.styleSummary = style_summary;
    if (personality_notes) updateData.personalityNotes = personality_notes;
    if (slang_vocab) updateData.slangVocab = slang_vocab;
    await updateKol(kolId, updateData);

    if (writing_samples?.length) {
      await appendWritingSamples(kolId, writing_samples, 50);
    }

    return { success: true };
  }

  async getCrawlTargets(limit: number, offset: number) {
    const result = await findKols({ isActive: true, limit, skip: offset });
    const kols = result.data.map(kol => ({
      id: kol._id!.toString(),
      handle: kol.handle,
      platform: kol.platform,
      lastCrawledAt: kol.lastCrawledAt,
      profileUrl: kol.profileUrl,
    }));
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
        const kolPost = await createKolPost({
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
        });
        created++;
        // Trigger AI processing pipeline for each new post
        await this.aiQueue.add(
          'process-post',
          { kolPostId: kolPost._id!.toString(), kolId },
          { attempts: 2, backoff: 30_000 },
        );
      } catch (e: unknown) {
        // Check for duplicate key error (MongoDB error code 11000)
        if ((e as { code?: number }).code === 11000) {
          duplicates++; // unique constraint on postUrl
        } else {
          throw e;
        }
      }
    }

    // Check if we should re-run style learning
    const kol = await findKolById(kolId);

    if (kol) {
      const newPostCount = await countKolPosts({ kolId });
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
      await upsertKolPostProcessing(kolPostId, {
        topComments: top_comments as object[],
        sentimentJson: {},
        trendSummary: '',
      });
    }

    // Re-trigger AI pipeline now that comments are available
    const kolPost = await findKolPostById(kolPostId);

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
      await updatePendingComment(commentId, { status: 'FAILED' as never });
      return { success: false };
    }

    await updatePendingComment(commentId, { postedAt: new Date(), postedUrl: posted_url });

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
      await updatePendingComment(commentId, { status: finalStatus as never });
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
