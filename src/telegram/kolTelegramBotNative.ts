/** KolTelegramBotNative — Telegram bot for KOL engagement using native https API */
import * as https from "https";
import { log } from "../utils/logger.js";
import { KolProfile } from "../db/models/KolProfile.js";
import { KolPost } from "../db/models/KolPost.js";
import {
  KolReplySuggestion,
  EReplyMode,
  EReplyExecutionStatus,
} from "../db/models/KolReplySuggestion.js";
import { KolSettings } from "../db/models/KolSettings.js";
import { replyEngineService } from "../services/replyEngineService.js";
import type { IKolReplySuggestion } from "../db/models/KolReplySuggestion.js";

// ── Configuration ────────────────────────────────────────────────────────────

function getBotToken(): string {
  return process.env.KOL_BOT_TOKEN || "";
}

function getAdminChatId(): string {
  return process.env.TELEGRAM_ADMIN_CHAT_ID || "";
}

// ── Low-level API helpers ────────────────────────────────────────────────────

async function callTelegram(
  method: string,
  body: Record<string, unknown>,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const token = getBotToken();
    if (!token) {
      return reject(new Error("KOL_BOT_TOKEN not configured"));
    }

    const dataStr = JSON.stringify(body);
    const options = {
      hostname: "api.telegram.org",
      port: 443,
      path: `/bot${token}/${method}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(dataStr),
      },
      family: 4,
    };

    const req = https.request(options, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => (responseBody += chunk));
      res.on("end", () => {
        try {
          const data = JSON.parse(responseBody);
          if (!data.ok) {
            log.error(`[KolTelegramBot] API error [${method}]: ${responseBody}`);
            return reject(new Error(`Telegram ${method} failed: ${data.description}`));
          }
          resolve(data.result);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", (e) => reject(e));
    req.write(dataStr);
    req.end();
  });
}

/** Escape special characters for Telegram MarkdownV2. */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

// ── Keyboard Builders ────────────────────────────────────────────────────────

function buildSuggestionKeyboard(suggestionId: string, suggestionCount: number) {
  const buttons = [];

  // Approve buttons for each suggestion
  for (let i = 0; i < Math.min(suggestionCount, 3); i++) {
    buttons.push([{
      text: `✅ Approve ${i + 1}`,
      callback_data: `kol_approve:${suggestionId}:${i}`,
    }]);
  }

  // Edit and reject
  buttons.push([
    { text: "✏️ Edit", callback_data: `kol_edit:${suggestionId}:0` },
    { text: "❌ Reject", callback_data: `kol_reject:${suggestionId}` },
  ]);

  // Regenerate
  buttons.push([
    { text: "🔄 Regenerate", callback_data: `kol_regen:${suggestionId}` },
  ]);

  // View post
  buttons.push([
    { text: "🔗 View Post", callback_data: `kol_view:${suggestionId}` },
  ]);

  return { inline_keyboard: buttons };
}

function buildMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📋 Pending Reviews", callback_data: "kol_pending" }],
      [{ text: "👥 List KOLs", callback_data: "kol_list" }, { text: "📊 Stats", callback_data: "kol_stats" }],
      [{ text: "⚙️ Settings", callback_data: "kol_settings" }],
    ],
  };
}

// ── Message Sending ──────────────────────────────────────────────────────────

export async function sendSuggestionForReview(
  suggestion: IKolReplySuggestion,
): Promise<{ message_id: number } | null> {
  const chatId = getAdminChatId();
  if (!chatId) {
    log.error("[KolTelegramBot] TELEGRAM_ADMIN_CHAT_ID not configured");
    return null;
  }

  const post = await KolPost.findById(suggestion.kol_post_id).populate("kol_id");
  if (!post) return null;

  const kol = post.kol_id as unknown as { handle: string };
  const handle = kol?.handle || "unknown";

  let text = `📱 *New KOL Post from @${escapeMarkdown(handle)}*\n\n`;
  text += `📝 *Post:*\n${escapeMarkdown(post.content.substring(0, 200))}${post.content.length > 200 ? "..." : ""}\n\n`;
  text += `💡 *AI Suggestions:*\n`;

  suggestion.suggestions.forEach((s, i) => {
    text += `${i + 1}\. \"${escapeMarkdown(s.content)}\"\n`;
    text += `   Confidence: ${s.confidence}% \| Tone: ${escapeMarkdown(s.tone)}\n\n`;
  });

  try {
    const result = await callTelegram("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "MarkdownV2",
      reply_markup: buildSuggestionKeyboard(String(suggestion._id), suggestion.suggestions.length),
    });

    // Store message ID
    await KolReplySuggestion.findByIdAndUpdate(suggestion._id, {
      telegram_message_id: result.message_id,
    });

    log.info(`[KolTelegramBot] Sent suggestion ${suggestion._id} for review`);
    return result;
  } catch (error) {
    log.error(`[KolTelegramBot] Failed to send suggestion: ${(error as Error).message}`);
    return null;
  }
}

export async function sendAFKNotification(
  suggestion: IKolReplySuggestion,
): Promise<void> {
  const chatId = getAdminChatId();
  if (!chatId) return;

  const post = await KolPost.findById(suggestion.kol_post_id).populate("kol_id");
  if (!post) return;

  const kol = post.kol_id as unknown as { handle: string };

  const text =
    `🤖 *Auto\-Reply Sent*\n\n` +
    `To: @${escapeMarkdown(kol?.handle || "unknown")}\n` +
    `Post: "${escapeMarkdown(post.content.substring(0, 100))}..."\n\n` +
    `Reply sent successfully in AFK mode\.`;

  try {
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "MarkdownV2",
    });
  } catch (error) {
    log.error(`[KolTelegramBot] Failed to send AFK notification: ${(error as Error).message}`);
  }
}

export async function sendMainMenu(): Promise<void> {
  const chatId = getAdminChatId();
  if (!chatId) return;

  const text =
    `🤖 *KOL Engagement Bot*\n\n` +
    `Welcome\! Use this bot to manage KOL interactions\.\n\n` +
    `• Auto\-crawl posts every 30 minutes\n` +
    `• AI analyzes and suggests replies\n` +
    `• Manual approval or AFK mode\n\n` +
    `Select an option:`;

  await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "MarkdownV2",
    reply_markup: buildMainMenuKeyboard(),
  });
}

export async function sendKolsList(page = 1): Promise<void> {
  const chatId = getAdminChatId();
  if (!chatId) return;

  const pageSize = 10;
  const skip = (page - 1) * pageSize;

  const kols = await KolProfile.find({ is_active: true })
    .sort({ reputation_score: -1 })
    .skip(skip)
    .limit(pageSize);

  let text = `👥 *Active KOLs* \(Page ${page}\)\n\n`;

  for (const kol of kols) {
    text += `• @${escapeMarkdown(kol.handle)}\n`;
    text += `  📈 Rep: ${kol.reputation_score} \| Posts: ${kol.post_frequency}/day\n\n`;
  }

  await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "MarkdownV2",
  });
}

export async function sendPendingList(): Promise<void> {
  const chatId = getAdminChatId();
  if (!chatId) return;

  const pending = await replyEngineService.getPendingManualSuggestions();

  if (pending.length === 0) {
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text: "✅ *No Pending Reviews*\n\nAll caught up\!",
      parse_mode: "MarkdownV2",
    });
    return;
  }

  const text = `📋 *${pending.length} Pending Review${pending.length > 1 ? "s" : ""}*\n\nChecking...`;

  await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "MarkdownV2",
  });

  // Send each pending suggestion
  for (const suggestion of pending.slice(0, 3)) {
    await sendSuggestionForReview(suggestion);
  }
}

export async function sendStats(): Promise<void> {
  const chatId = getAdminChatId();
  if (!chatId) return;

  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    postsCrawled,
    suggestionsGenerated,
    repliesSent,
    pendingManual,
    activeKols,
  ] = await Promise.all([
    KolPost.countDocuments({ crawled_at: { $gte: twentyFourHoursAgo } }),
    KolReplySuggestion.countDocuments({ created_at: { $gte: twentyFourHoursAgo } }),
    KolReplySuggestion.countDocuments({
      sent_at: { $gte: twentyFourHoursAgo },
      execution_status: EReplyExecutionStatus.SENT,
    }),
    KolReplySuggestion.countDocuments({
      mode: EReplyMode.MANUAL,
      execution_status: EReplyExecutionStatus.PENDING,
    }),
    KolProfile.countDocuments({ is_active: true }),
  ]);

  const text =
    `📊 *Last 24 Hours Stats*\n\n` +
    `📥 Posts Crawled: ${postsCrawled}\n` +
    `💡 Suggestions Generated: ${suggestionsGenerated}\n` +
    `📤 Replies Sent: ${repliesSent}\n` +
    `⏳ Pending Manual: ${pendingManual}\n` +
    `👥 Active KOLs: ${activeKols}`;

  await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "MarkdownV2",
  });
}

// ── Callback Handlers ────────────────────────────────────────────────────────

export async function handleCallbackQuery(callbackQuery: {
  id: string;
  from: { id: number };
  message?: { chat: { id: number }; message_id: number };
  data?: string;
}): Promise<void> {
  if (!callbackQuery.data) return;

  const chatId = String(callbackQuery.message?.chat.id);
  const messageId = callbackQuery.message?.message_id;
  const data = callbackQuery.data;

  // Answer callback to dismiss loading spinner
  try {
    await callTelegram("answerCallbackQuery", {
      callback_query_id: callbackQuery.id,
    });
  } catch {
    // Ignore
  }

  // Handle different callback types
  if (data.startsWith("kol_approve:")) {
    const [, suggestionId, suggestionIndex] = data.split(":");
    await handleApprove(chatId, messageId, suggestionId, parseInt(suggestionIndex, 10));
  } else if (data.startsWith("kol_reject:")) {
    const [, suggestionId] = data.split(":");
    await handleReject(chatId, messageId, suggestionId);
  } else if (data.startsWith("kol_regen:")) {
    const [, suggestionId] = data.split(":");
    await handleRegenerate(chatId, messageId, suggestionId);
  } else if (data === "kol_pending") {
    await sendPendingList();
  } else if (data === "kol_list") {
    await sendKolsList();
  } else if (data === "kol_stats") {
    await sendStats();
  } else if (data === "kol_settings") {
    await sendSettings(chatId);
  }
}

async function handleApprove(
  chatId: string,
  messageId: number | undefined,
  suggestionId: string,
  suggestionIndex: number,
): Promise<void> {
  const result = await replyEngineService.approveSuggestion(suggestionId, suggestionIndex);

  const text = result.success
    ? "✅ *Approved and Sent*\n\nReply has been posted successfully\."
    : `❌ *Approval Failed*\n\nError: ${escapeMarkdown(result.error || "Unknown error")}`;

  if (messageId) {
    await callTelegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "MarkdownV2",
    });
  }
}

async function handleReject(
  chatId: string,
  messageId: number | undefined,
  suggestionId: string,
): Promise<void> {
  await replyEngineService.rejectSuggestion(suggestionId);

  if (messageId) {
    await callTelegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: "❌ *Rejected*\n\nThis suggestion has been rejected\.",
      parse_mode: "MarkdownV2",
    });
  }
}

async function handleRegenerate(
  chatId: string,
  messageId: number | undefined,
  suggestionId: string,
): Promise<void> {
  const result = await replyEngineService.regenerateSuggestions(suggestionId);

  if (!result) {
    if (messageId) {
      await callTelegram("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: "⚠️ *Cannot Regenerate*\n\nThis suggestion was already superseded or not found\.",
        parse_mode: "MarkdownV2",
      });
    }
    return;
  }

  if (messageId) {
    await callTelegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: "🔄 *Regenerating suggestions\\.\\.\\.*\n\nNew suggestions will arrive shortly\.",
      parse_mode: "MarkdownV2",
    });
  }
}

export async function handleReplyToSuggestion(message: {
  text?: string;
  chat: { id: number };
  reply_to_message?: { message_id: number };
}): Promise<void> {
  const replyToMessageId = message.reply_to_message?.message_id;
  if (!replyToMessageId || !message.text) return;

  const suggestion = await KolReplySuggestion.findOne({
    telegram_message_id: replyToMessageId,
  });
  if (!suggestion) return;

  const userInstruction = message.text.trim();
  if (!userInstruction) return;

  const chatId = String(message.chat.id);
  const result = await replyEngineService.regenerateSuggestions(
    String(suggestion._id),
    userInstruction,
  );

  if (!result) {
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text: "⚠️ Could not regenerate\\. Suggestion may already be superseded\\.",
      parse_mode: "MarkdownV2",
    });
    return;
  }

  await callTelegram("sendMessage", {
    chat_id: chatId,
    text: `🔄 *Regenerating with:* "${escapeMarkdown(userInstruction)}"\n\nNew suggestions will arrive shortly\\.`,
    parse_mode: "MarkdownV2",
    reply_to_message_id: replyToMessageId,
  });

  await callTelegram("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: replyToMessageId,
    reply_markup: { inline_keyboard: [] },
  });
}

async function sendSettings(chatId: string): Promise<void> {
  const settings = await KolSettings.getSettings();
  const mode = settings.default_mode;

  const text =
    `⚙️ *Current Mode: ${mode.toUpperCase()}*\n\n` +
    (mode === EReplyMode.AFK
      ? "🤖 *AFK Mode:* Auto\-reply based on confidence threshold\n" +
        `• Min confidence: ${settings.afk.min_confidence_threshold}%\n` +
        `• Delay: ${settings.afk.auto_delay_min_minutes}-${settings.afk.auto_delay_max_minutes} min`
      : "👤 *Manual Mode:* All require approval");

  await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "MarkdownV2",
  });
}

// ── Command Handlers ─────────────────────────────────────────────────────────

export async function handleCommand(message: {
  text?: string;
  chat: { id: number };
}): Promise<void> {
  const chatId = String(message.chat.id);
  const text = message.text || "";
  const command = text.split(" ")[0];

  switch (command) {
    case "/start":
    case "/menu":
      await sendMainMenu();
      break;
    case "/kols":
      await sendKolsList();
      break;
    case "/pending":
      await sendPendingList();
      break;
    case "/stats":
      await sendStats();
      break;
    default:
      // Unknown command
      break;
  }
}

// ── Webhook Setup ─────────────────────────────────────────────────────────────

export async function setupWebhook(webhookUrl: string): Promise<void> {
  try {
    const params: Record<string, unknown> = { url: webhookUrl };
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret) {
      params.secret_token = secret;
    }
    await callTelegram("setWebhook", params);
    log.info(`[KolTelegramBot] Webhook set to ${webhookUrl}`);
  } catch (error) {
    log.error(`[KolTelegramBot] Failed to set webhook: ${(error as Error).message}`);
    throw error;
  }
}

export async function removeWebhook(dropPendingUpdates = false): Promise<void> {
  await callTelegram("deleteWebhook", {
    drop_pending_updates: dropPendingUpdates,
  });
}

export async function getWebhookInfo(): Promise<unknown> {
  return callTelegram("getWebhookInfo", {});
}

// ── Status Check ───────────────────────────────────────────────────────────────

export function isConfigured(): boolean {
  return getBotToken().length > 0 && getAdminChatId().length > 0;
}
