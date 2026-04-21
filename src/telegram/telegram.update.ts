import { Update, Start, Command, Action, Ctx } from 'nestjs-telegraf';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Context } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from './telegram.service';
import { BULL_QUEUES, KOL_CONSTANTS } from '../common/constants/kol.constants';

@Update()
export class TelegramUpdate {
  private readonly logger = new Logger(TelegramUpdate.name);

  constructor(
    private readonly telegramService: TelegramService,
    private readonly prisma: PrismaService,
    @InjectQueue(BULL_QUEUES.ENGAGEMENT) private readonly engagementQueue: Queue,
    @InjectQueue(BULL_QUEUES.TELEGRAM_APPROVAL) private readonly approvalQueue: Queue,
    @InjectQueue(BULL_QUEUES.AI_PIPELINE) private readonly aiQueue: Queue,
  ) {}

  @Start()
  async onStart(@Ctx() ctx: Context): Promise<void> {
    const mode = await this.telegramService.getMode();
    await ctx.reply(
      `👋 Bot is running.\nCurrent mode: <b>${mode.toUpperCase()}</b>\n\nCommands:\n/afk — auto-post mode\n/manual — human review mode\n/status — show current mode`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('afk')
  async onAfk(@Ctx() ctx: Context): Promise<void> {
    await this.telegramService.setMode('afk');
    await ctx.reply('✅ Mode set to <b>AFK</b> — comments will be posted automatically.', {
      parse_mode: 'HTML',
    });
  }

  @Command('manual')
  async onManual(@Ctx() ctx: Context): Promise<void> {
    await this.telegramService.setMode('manual');
    await ctx.reply('✅ Mode set to <b>MANUAL</b> — comments require your approval.', {
      parse_mode: 'HTML',
    });
  }

  @Command('status')
  async onStatus(@Ctx() ctx: Context): Promise<void> {
    const mode = await this.telegramService.getMode();
    const pending = await this.prisma.pendingComment.count({
      where: { status: 'PENDING_REVIEW' },
    });
    await ctx.reply(
      `📊 Status:\nMode: <b>${mode.toUpperCase()}</b>\nPending approvals: <b>${pending}</b>`,
      { parse_mode: 'HTML' },
    );
  }

  // Handle [Approve & Post] button — callback_data: "approve:{pendingCommentId}"
  @Action(/^approve:(.+)$/)
  async onApprove(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery('Processing...');
    const callbackData = (ctx as unknown as { callbackQuery: { data: string } }).callbackQuery?.data;
    const pendingCommentId = callbackData.replace('approve:', '');

    const comment = await this.prisma.pendingComment.findUnique({
      where: { id: pendingCommentId },
      include: { kolPost: true },
    });

    if (!comment || comment.status !== 'PENDING_REVIEW') {
      await ctx.answerCbQuery('Already handled.');
      return;
    }

    // Cancel the timeout fallback job
    await this.telegramService.cancelTimeoutJob(pendingCommentId);

    // Mark approved
    await this.prisma.pendingComment.update({
      where: { id: pendingCommentId },
      data: { status: 'APPROVED', reviewedAt: new Date(), reviewedBy: 'telegram' },
    });

    // Reject other candidates for this post
    await this.prisma.pendingComment.updateMany({
      where: {
        kolPostId: comment.kolPostId,
        id: { not: pendingCommentId },
        status: 'PENDING_REVIEW',
      },
      data: { status: 'REJECTED' },
    });

    // Enqueue engagement with anti-ban delay
    const delayMs = this.randomDelay(
      KOL_CONSTANTS.DEFAULT_REPLY_RATE_LIMIT_MIN,
      KOL_CONSTANTS.DEFAULT_REPLY_RATE_LIMIT_MAX,
    );

    await this.engagementQueue.add(
      'post-comment',
      { pendingCommentId, kolPostId: comment.kolPostId, postUrl: comment.kolPost.postUrl },
      { delay: delayMs, attempts: 2 },
    );

    // Remove inline buttons from Telegram message
    const msgId = (ctx as unknown as { callbackQuery: { message: { message_id: number } } })
      .callbackQuery?.message?.message_id?.toString();
    if (msgId) await this.telegramService.removeApprovalButtons(msgId);

    await ctx.reply(
      `✅ Approved! Posting in ~${Math.round(delayMs / 60000)} minute(s).\n\n"${comment.content.slice(0, 100)}"`,
    );
    this.logger.log(`Comment ${pendingCommentId} approved via Telegram`);
  }

  // Handle [Reject all] button — callback_data: "reject:{kolPostId}"
  @Action(/^reject:(.+)$/)
  async onReject(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery('Rejected.');
    const callbackData = (ctx as unknown as { callbackQuery: { data: string } }).callbackQuery?.data;
    const kolPostId = callbackData.replace('reject:', '');

    await this.prisma.pendingComment.updateMany({
      where: { kolPostId, status: 'PENDING_REVIEW' },
      data: { status: 'REJECTED', reviewedAt: new Date(), reviewedBy: 'telegram' },
    });

    const msgId = (ctx as unknown as { callbackQuery: { message: { message_id: number } } })
      .callbackQuery?.message?.message_id?.toString();
    if (msgId) await this.telegramService.removeApprovalButtons(msgId);

    await ctx.reply('❌ All candidates rejected for this post.');
    this.logger.log(`All candidates rejected for post ${kolPostId}`);
  }

  // Handle [Regenerate] button — callback_data: "regenerate:{kolPostId}"
  @Action(/^regenerate:(.+)$/)
  async onRegenerate(@Ctx() ctx: Context): Promise<void> {
    await ctx.answerCbQuery('Regenerating...');
    const callbackData = (ctx as unknown as { callbackQuery: { data: string } }).callbackQuery?.data;
    const kolPostId = callbackData.replace('regenerate:', '');

    // Cancel existing timeout jobs for all pending comments on this post
    const pending = await this.prisma.pendingComment.findMany({
      where: { kolPostId, status: 'PENDING_REVIEW' },
    });
    for (const c of pending) {
      await this.telegramService.cancelTimeoutJob(c.id);
    }

    // Reject current candidates
    await this.prisma.pendingComment.updateMany({
      where: { kolPostId, status: 'PENDING_REVIEW' },
      data: { status: 'REJECTED' },
    });

    // Re-queue AI pipeline for this post
    const kolPost = await this.prisma.kolPost.findUnique({ where: { id: kolPostId } });
    if (kolPost) {
      await this.aiQueue.add(
        'process-post',
        { kolPostId, kolId: kolPost.kolId },
        { attempts: 2 },
      );
    }

    const msgId = (ctx as unknown as { callbackQuery: { message: { message_id: number } } })
      .callbackQuery?.message?.message_id?.toString();
    if (msgId) await this.telegramService.removeApprovalButtons(msgId);

    await ctx.reply('🔄 Regenerating comment candidates...');
    this.logger.log(`Regenerating candidates for post ${kolPostId}`);
  }

  private randomDelay(minMinutes: number, maxMinutes: number): number {
    const minMs = minMinutes * 60 * 1000;
    const maxMs = maxMinutes * 60 * 1000;
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  }
}
