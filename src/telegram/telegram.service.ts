import { Injectable, Logger } from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import { Telegraf } from 'telegraf';
import Redis from 'ioredis';
import { BULL_QUEUES } from '../common/constants/kol.constants';

export interface ApprovalPayload {
  kolPostId: string;
  kolId: string;
  kolHandle: string;
  postContent: string;
  postUrl: string;
  summary: string;
  sentiment: {
    sentiment: string;
    positive_pct: number;
    neutral_pct: number;
    negative_pct: number;
    trend_summary: string;
  };
  candidates: { id: string; content: string; alignment: string }[];
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  private readonly adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID ?? '';

  constructor(
    @InjectBot() private readonly bot: Telegraf,
    @InjectQueue(BULL_QUEUES.TELEGRAM_APPROVAL) private readonly approvalQueue: Queue,
  ) {}

  async getMode(): Promise<'afk' | 'manual'> {
    const mode = await this.redis.get('bot:mode');
    return mode === 'afk' ? 'afk' : 'manual';
  }

  async setMode(mode: 'afk' | 'manual'): Promise<void> {
    await this.redis.set('bot:mode', mode);
    this.logger.log(`Bot mode set to: ${mode}`);
  }

  async sendApprovalMessage(payload: ApprovalPayload): Promise<string> {
    const sentimentBar = this.buildSentimentBar(payload.sentiment);
    const text = [
      `🔔 <b>New KOL Post — @${payload.kolHandle}</b>`,
      ``,
      `📝 <b>Summary:</b> ${payload.summary}`,
      ``,
      `${sentimentBar}`,
      `💬 <i>${payload.sentiment.trend_summary}</i>`,
      ``,
      `🔗 <a href="${payload.postUrl}">View post</a>`,
      ``,
      `<b>Choose a comment to post:</b>`,
    ].join('\n');

    const inlineKeyboard = [
      // One row per candidate
      ...payload.candidates.map((c) => [
        {
          text: `${this.alignmentEmoji(c.alignment)} ${c.content.slice(0, 40)}${c.content.length > 40 ? '…' : ''}`,
          callback_data: `approve:${c.id}`,
        },
      ]),
      // Action row
      [
        { text: '❌ Reject all', callback_data: `reject:${payload.kolPostId}` },
        { text: '🔄 Regenerate', callback_data: `regenerate:${payload.kolPostId}` },
      ],
    ];

    const sent = await this.bot.telegram.sendMessage(this.adminChatId, text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: inlineKeyboard },
    });

    const messageId = sent.message_id.toString();
    this.logger.log(`Sent approval message ${messageId} for post ${payload.kolPostId}`);
    return messageId;
  }

  async removeApprovalButtons(messageId: string): Promise<void> {
    try {
      await this.bot.telegram.editMessageReplyMarkup(
        this.adminChatId,
        parseInt(messageId, 10),
        undefined,
        { inline_keyboard: [] },
      );
    } catch {
      // Message may already be edited — ignore
    }
  }

  async sendNotification(text: string): Promise<void> {
    await this.bot.telegram.sendMessage(this.adminChatId, text, { parse_mode: 'HTML' });
  }

  async cancelTimeoutJob(pendingCommentId: string): Promise<void> {
    const jobId = `approval-${pendingCommentId}`;
    const job: Job | null = await this.approvalQueue.getJob(jobId);
    if (job) {
      await job.remove();
      this.logger.log(`Cancelled timeout job for comment ${pendingCommentId}`);
    }
  }

  private buildSentimentBar(sentiment: ApprovalPayload['sentiment']): string {
    const { positive_pct, neutral_pct, negative_pct } = sentiment;
    return `📊 Sentiment: 🟢 ${positive_pct}% positive · ⚪ ${neutral_pct}% neutral · 🔴 ${negative_pct}% negative`;
  }

  private alignmentEmoji(alignment: string): string {
    return alignment === 'positive' ? '🟢' : alignment === 'negative' ? '🔴' : '⚪';
  }
}
