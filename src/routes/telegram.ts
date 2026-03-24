/** Telegram webhook routes — handle callbacks and messages from Telegram. */
import { Router, type Request, type Response } from "express";
import { Post, EPostStatus } from "../db/index.js";
import * as telegramService from "../services/telegramService.js";
import { log } from "../utils/logger.js";
import { execSync } from "child_process";
import { settings } from "../config/settings.js";

export const telegramRouter = Router();
enum EPendingAction {
  EDIT = "edit",
  SCHEDULE = "schedule",
  AI_PROMPT = "ai_prompt",
}

enum EAgentAction {
  APPROVE = "approve",
  REJECT = "reject",
  EDIT = "edit",
  AI_REWRITE = "ai_rewrite",
  SCHEDULE = "schedule",
}

/** In-memory state for pending user inputs (edit or schedule). */
const pendingActions = new Map<
  string,
  { action: EPendingAction; draftId: string }
>();

// ── Helpers ──────────────────────────────────────────────────────────────────

function runOpenClaw(message: string): string {
  const escaped = message.replace(/'/g, "'\\''");
  return execSync(
    `openclaw agent --agent ${settings.openClawAgent} --message '${escaped}'`,
    {
      encoding: "utf-8",
      timeout: 120_000,
    },
  ).trim();
}

// ── Webhook endpoint ─────────────────────────────────────────────────────────

/** Receive Telegram webhook updates. */
telegramRouter.post("/webhook", async (req: Request, res: Response) => {
  try {
    const update = req.body;

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    } else if (update.message?.text) {
      await handleTextMessage(update.message);
    }

    res.sendStatus(200);
  } catch (e: any) {
    log.error(`Telegram webhook error: ${e.message}`);
    res.sendStatus(200);
  }
});

/** Setup webhook URL. */
telegramRouter.post("/setup", async (req: Request, res: Response) => {
  try {
    const { webhook_url } = req.body;
    if (!webhook_url) {
      return res
        .status(400)
        .json({ success: false, error: "webhook_url is required" });
    }
    const result = await telegramService.setupWebhook(webhook_url);
    res.json({ success: true, result });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Get bot / webhook status. */
telegramRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    const info = await telegramService.getWebhookInfo();
    res.json({
      success: true,
      configured: telegramService.isConfigured(),
      webhook: info,
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Callback Query Handler ───────────────────────────────────────────────────

async function handleCallbackQuery(query: any) {
  const chatId = query.message?.chat?.id?.toString();
  const data: string = query.data || "";
  const callbackId = query.id;

  log.info(`Telegram callback: ${data} from chat ${chatId}`);

  const parts = data.match(/^(approve|reject|edit|ai_rewrite|schedule)_(.+)$/);
  if (!parts) {
    await telegramService.answerCallback(callbackId, "❓ Unknown action");
    return;
  }

  const [, action, draftId] = parts;
  const draft = await Post.findById(draftId);

  if (!draft) {
    await telegramService.answerCallback(callbackId, "❌ Draft not found");
    return;
  }

  switch (action) {
    case EAgentAction.APPROVE: {
      draft.status = EPostStatus.APPROVED;
      await draft.save();
      await telegramService.answerCallback(callbackId, "✅ Approved!");
      await telegramService.sendMessage(
        `✅ Đã approve! Bài viết sẽ được đăng sớm.\n\nNội dung:\n${draft.raw_content}`,
        chatId,
      );
      break;
    }

    case EAgentAction.REJECT: {
      draft.status = EPostStatus.REJECTED;
      await draft.save();
      await telegramService.answerCallback(callbackId, "❌ Rejected");
      await telegramService.sendMessage(`❌ Draft đã bị reject.`, chatId);
      break;
    }

    case EAgentAction.EDIT: {
      pendingActions.set(chatId!, { action: EPendingAction.EDIT, draftId });
      await telegramService.answerCallback(callbackId, "✏️ Gửi nội dung mới");
      await telegramService.sendMessage(
        `✏️ Gửi nội dung mới cho draft này.`,
        chatId,
      );
      break;
    }

    case EAgentAction.AI_REWRITE: {
      pendingActions.set(chatId!, {
        action: EPendingAction.AI_PROMPT,
        draftId,
      });
      await telegramService.answerCallback(callbackId, "🤖 Nhập hướng dẫn");
      await telegramService.sendMessage(
        `🤖 Nhập hướng dẫn cho AI rewrite.\n\nVí dụ: make it shorter and more punchy`,
        chatId,
      );
      break;
    }

    case EAgentAction.SCHEDULE: {
      pendingActions.set(chatId!, { action: EPendingAction.SCHEDULE, draftId });
      await telegramService.answerCallback(callbackId, "⏰ Nhập giờ");
      await telegramService.sendMessage(
        `⏰ Nhập giờ đăng bài (format: HH:MM hoặc YYYY-MM-DD HH:MM)\n\nVí dụ: 14:30 hoặc 2026-03-24 10:00`,
        chatId,
      );
      break;
    }
  }
}

// ── Text Message Handler ─────────────────────────────────────────────────────

async function handleTextMessage(message: any) {
  const chatId = message.chat?.id?.toString();
  const text: string = message.text || "";

  if (!chatId) return;

  const pending = pendingActions.get(chatId);

  if (!pending) {
    await telegramService.sendMessage(
      `💡 Không có hành động nào đang chờ.\n\nDùng các nút bên dưới bài draft để tương tác.`,
      chatId,
    );
    return;
  }

  switch (pending.action) {
    case EPendingAction.EDIT:
      handleEdit(pending, text, chatId);
      break;
    case EPendingAction.AI_PROMPT:
      handleAiPrompt(pending, text, chatId);
      break;
    case EPendingAction.SCHEDULE:
      handleSchedule(pending, text, chatId);
      break;
  }
}

async function handleEdit(
  pending: { action: EPendingAction; draftId: string },
  text: string,
  chatId: string,
) {
  const draft = await Post.findById(pending.draftId);
  if (!draft) {
    await telegramService.sendMessage("❌ Draft not found", chatId);
    pendingActions.delete(chatId);
    return;
  }

  draft.edit_history.push({
    content: draft.raw_content,
    edited_at: new Date(),
    edited_by: "user",
  });
  draft.raw_content = text;
  draft.status = EPostStatus.PENDING_REVIEW;
  await draft.save();

  await telegramService.sendUpdatedPreview(
    draft._id.toString(),
    draft.raw_content,
    draft.edit_history.length + 1,
    chatId,
  );

  pendingActions.delete(chatId);
  return;
}

async function handleAiPrompt(
  pending: { action: EPendingAction; draftId: string },
  text: string,
  chatId: string,
) {
  const aiInstruction = text.trim();

  if (!aiInstruction) {
    await telegramService.sendMessage(
      "❌ Hướng dẫn không được để trống",
      chatId,
    );
    return;
  }

  const draft = await Post.findById(pending.draftId);
  if (!draft) {
    await telegramService.sendMessage("❌ Draft not found", chatId);
    pendingActions.delete(chatId);
    return;
  }

  await telegramService.sendMessage(
    `🤖 Đang sửa theo: ${aiInstruction}`,
    chatId,
  );

  try {
    const aiPrompt = `You are editing a social media post for X (Twitter).

Current content:
"""
${draft.raw_content}
"""

User instruction: ${aiInstruction}

Rules:
- Keep it under 300 words
- Maintain the CEO/visionary tone about AI filmmaking
- Output ONLY the edited post, nothing else.`;

    const rewritten = runOpenClaw(aiPrompt);

    draft.edit_history.push({
      content: draft.raw_content,
      edited_at: new Date(),
      edited_by: "ai",
      prompt: aiInstruction,
    });
    draft.raw_content = rewritten;
    draft.status = EPostStatus.PENDING_REVIEW;
    await draft.save();

    await telegramService.sendUpdatedPreview(
      draft._id.toString(),
      draft.raw_content,
      draft.edit_history.length + 1,
      chatId,
    );
  } catch (err: any) {
    await telegramService.sendMessage(
      `❌ AI edit failed: ${err.message}`,
      chatId,
    );
  }

  pendingActions.delete(chatId);
  return;
}

async function handleSchedule(
  pending: { action: EPendingAction; draftId: string },
  text: string,
  chatId: string,
) {
  const draft = await Post.findById(pending.draftId);
  if (!draft) {
    await telegramService.sendMessage("❌ Draft not found", chatId);
    pendingActions.delete(chatId);
    return;
  }

  let scheduledDate: Date;
  const timeMatch = text.match(/^(\d{1,2}):(\d{2})$/);
  const fullMatch = text.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})$/);

  if (timeMatch) {
    const now = new Date();
    scheduledDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      parseInt(timeMatch[1]),
      parseInt(timeMatch[2]),
    );
    if (scheduledDate <= now) {
      scheduledDate.setDate(scheduledDate.getDate() + 1);
    }
  } else if (fullMatch) {
    scheduledDate = new Date(
      `${fullMatch[1]}T${fullMatch[2].padStart(2, "0")}:${fullMatch[3]}:00+07:00`,
    );
  } else {
    await telegramService.sendMessage(
      "❌ Format không đúng. Dùng HH:MM hoặc YYYY-MM-DD HH:MM",
      chatId,
    );
    return;
  }

  draft.status = EPostStatus.SCHEDULED;
  draft.scheduled_at = scheduledDate;
  await draft.save();

  const timeStr = scheduledDate.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
  await telegramService.sendMessage(
    `⏰ Đã schedule lúc ${timeStr}\n\nNội dung:\n${draft.raw_content}`,
    chatId,
  );

  pendingActions.delete(chatId);
  return;
}
