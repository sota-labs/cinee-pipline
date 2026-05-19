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
import { SelfReplyQueue, ECommentStatus } from "../db/models/SelfReplyQueue.js";
import { Post, EPostStatus } from "../db/models/Post.js";
import { replyEngineService } from "../services/replyEngineService.js";
import { selfReplyService } from "../services/selfReplyService.js";
import type { IKolReplySuggestion } from "../db/models/KolReplySuggestion.js";

// ── Edit State ───────────────────────────────────────────────────────────────

// chatId → suggestionId or "self:<queueId>:<commentId>", cleared after use or timeout
const pendingEditState = new Map<string, string>();

// ── Seed State ───────────────────────────────────────────────────────────────

type ESeedStep = "awaiting_content_type" | "awaiting_raw_content" | "awaiting_post_url" | "awaiting_confirm";

interface ISeedState {
  step: ESeedStep;
  content_type?: string;
  raw_content?: string;
  post_url?: string;
}

// chatId → ISeedState, cleared after use or 10-minute timeout
const pendingSeedState = new Map<string, ISeedState>();

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
  return String(text).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
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

/**
 * Send a streamlined confirmation for a pre-selected suggestion.
 * Used by Manual mode when the system auto-picks the best reply.
 */
export async function sendConfirmationRequest(
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

  const selected = suggestion.suggestions.find(
    (s) => s.id === suggestion.selected_suggestion_id,
  );
  if (!selected) return null;

  let text = `🤖 *Reply to @${escapeMarkdown(handle)}*\n\n`;
  text += `📝 *Post:* ${escapeMarkdown(post.content.substring(0, 150))}${post.content.length > 150 ? "\\.\\.\\." : ""}\n\n`;
  text += `💬 *Reply:* "${escapeMarkdown(selected.content)}"\n`;
  text += `📊 Confidence: ${escapeMarkdown(String(selected.confidence))}% \\| Tone: ${escapeMarkdown(selected.tone)}\n\n`;
  text += `⏱ _Auto\\-reject in 1 hour if no response_`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ Confirm", callback_data: `kol_confirm:${suggestion._id}` },
        { text: "✏️ Edit", callback_data: `kol_edit:${suggestion._id}` },
        { text: "❌ Reject", callback_data: `kol_confirm_reject:${suggestion._id}` },
      ],
    ],
  };

  try {
    const result = await callTelegram("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "MarkdownV2",
      reply_markup: keyboard,
    });

    await KolReplySuggestion.findByIdAndUpdate(suggestion._id, {
      telegram_message_id: result.message_id,
    });

    log.info(`[KolTelegramBot] Sent confirmation request for ${suggestion._id}`);
    return result;
  } catch (error) {
    log.error(`[KolTelegramBot] Failed to send confirmation: ${(error as Error).message}`);
    return null;
  }
}

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
  text += `📝 *Post:*\n${escapeMarkdown(post.content.substring(0, 200))}${post.content.length > 200 ? "\\.\\.\\." : ""}\n\n`;
  text += `💡 *AI Suggestions:*\n`;

  suggestion.suggestions.forEach((s, i) => {
    text += `${i + 1}\\. "${escapeMarkdown(s.content)}"\n`;
    text += `   Confidence: ${escapeMarkdown(String(s.confidence))}% \\| Tone: ${escapeMarkdown(s.tone)}\n\n`;
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

export async function sendSelfReplyConfirmation(
  queueId: string,
  commentId: string,
): Promise<void> {
  const chatId = getAdminChatId();
  if (!chatId) return;

  const queue = await SelfReplyQueue.findById(queueId);
  if (!queue) return;

  const comment = queue.pending_comments.find((c) => c.comment_id === commentId);
  if (!comment || !comment.reply_content) return;

  const post = await Post.findById(queue.our_post_id);
  const postSnippet = post
    ? escapeMarkdown(post.raw_content.substring(0, 100)) + (post.raw_content.length > 100 ? "\\.\\.\\." : "")
    : "_unknown post_";

  let text = `💬 *Reply to comment on your post*\n\n`;
  text += `📝 *Post:* ${postSnippet}\n\n`;
  text += `👤 *@${escapeMarkdown(comment.author_handle)}:* "${escapeMarkdown(comment.content)}"\n\n`;
  text += `🤖 *Reply:* "${escapeMarkdown(comment.reply_content)}"`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ Confirm", callback_data: `self_confirm:${queueId}:${commentId}` },
        { text: "✏️ Edit", callback_data: `self_edit:${queueId}:${commentId}` },
        { text: "❌ Reject", callback_data: `self_reject:${queueId}:${commentId}` },
      ],
    ],
  };

  try {
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "MarkdownV2",
      reply_markup: keyboard,
    });
    log.info(`[KolTelegramBot] Sent self-reply confirmation for comment ${commentId}`);
  } catch (error) {
    log.error(`[KolTelegramBot] Failed to send self-reply confirmation: ${(error as Error).message}`);
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

  let text = `👥 *Active KOLs* \\(Page ${escapeMarkdown(String(page))}\\)\n\n`;

  for (const kol of kols) {
    text += `• @${escapeMarkdown(kol.handle)}\n`;
    text += `  📈 Rep: ${escapeMarkdown(String(kol.reputation_score))} \\| Posts: ${escapeMarkdown(String(kol.post_frequency))}/day\n\n`;
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

  const text = `📋 *${escapeMarkdown(String(pending.length))} Pending Review${pending.length > 1 ? "s" : ""}*\n\nChecking\\.\\.\\.`;

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
    `📥 Posts Crawled: ${escapeMarkdown(String(postsCrawled))}\n` +
    `💡 Suggestions Generated: ${escapeMarkdown(String(suggestionsGenerated))}\n` +
    `📤 Replies Sent: ${escapeMarkdown(String(repliesSent))}\n` +
    `⏳ Pending Manual: ${escapeMarkdown(String(pendingManual))}\n` +
    `👥 Active KOLs: ${escapeMarkdown(String(activeKols))}`;

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
  } else if (data.startsWith("kol_confirm:")) {
    const [, suggestionId] = data.split(":");
    await handleConfirmApprove(chatId, messageId, suggestionId);
  } else if (data.startsWith("kol_confirm_reject:")) {
    const [, suggestionId] = data.split(":");
    await handleReject(chatId, messageId, suggestionId);
  } else if (data.startsWith("kol_edit:")) {
    const [, suggestionId] = data.split(":");
    await handleEdit(chatId, messageId, suggestionId);
  } else if (data.startsWith("self_confirm:")) {
    const [, queueId, commentId] = data.split(":");
    await handleSelfConfirm(chatId, messageId, queueId, commentId);
  } else if (data.startsWith("self_edit:")) {
    const [, queueId, commentId] = data.split(":");
    await handleSelfEdit(chatId, messageId, queueId, commentId);
  } else if (data.startsWith("self_reject:")) {
    const [, queueId, commentId] = data.split(":");
    await handleSelfReject(chatId, messageId, queueId, commentId);
  } else if (data === "kol_pending") {
    await sendPendingList();
  } else if (data === "kol_list") {
    await sendKolsList();
  } else if (data === "kol_stats") {
    await sendStats();
  } else if (data === "kol_settings") {
    await sendSettings(chatId);
  } else if (data.startsWith("seed_type:") || data === "seed_confirm" || data === "seed_cancel") {
    await handleSeedCallback(chatId, messageId, data);
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

async function handleConfirmApprove(
  chatId: string,
  messageId: number | undefined,
  suggestionId: string,
): Promise<void> {
  const suggestion = await KolReplySuggestion.findById(suggestionId);
  if (!suggestion || !suggestion.selected_suggestion_id) {
    if (messageId) {
      await callTelegram("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: "❌ *Error*\n\nSuggestion not found or no pre\\-selected reply\\.",
        parse_mode: "MarkdownV2",
      });
    }
    return;
  }

  const index = suggestion.suggestions.findIndex(
    (s) => s.id === suggestion.selected_suggestion_id,
  );
  if (index === -1) return;

  const result = await replyEngineService.approveSuggestion(suggestionId, index);

  const text = result.success
    ? "✅ *Confirmed and Sent*\n\nReply posted successfully\\."
    : `❌ *Failed*\n\n${escapeMarkdown(result.error || "Unknown error")}`;

  if (messageId) {
    await callTelegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "MarkdownV2",
    });
  }
}

async function handleEdit(
  chatId: string,
  messageId: number | undefined,
  suggestionId: string,
): Promise<void> {
  pendingEditState.set(chatId, suggestionId);

  // Clear pending state after 5 minutes if user doesn't respond
  setTimeout(() => pendingEditState.delete(chatId), 5 * 60 * 1000);

  const promptText =
    `✏️ *Edit Reply*\n\n` +
    `Type your custom reply text and send it\\.\n` +
    `_Reply will be sent as\\-is\\._\n\n` +
    `Send /cancel to cancel\\.`;

  if (messageId) {
    await callTelegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: promptText,
      parse_mode: "MarkdownV2",
    });
  } else {
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text: promptText,
      parse_mode: "MarkdownV2",
    });
  }
}

async function handleSelfConfirm(
  chatId: string,
  messageId: number | undefined,
  queueId: string,
  commentId: string,
): Promise<void> {
  const queue = await SelfReplyQueue.findById(queueId);
  const comment = queue?.pending_comments.find((c) => c.comment_id === commentId);

  if (!comment?.reply_content) {
    if (messageId) {
      await callTelegram("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: "❌ *Error*\n\nReply content not found\\.",
        parse_mode: "MarkdownV2",
      });
    }
    return;
  }

  const result = await selfReplyService.sendReply(queueId, commentId, comment.reply_content);
  const text = result.success
    ? "✅ *Confirmed and Queued*\n\nReply will be posted shortly\\."
    : `❌ *Failed*\n\n${escapeMarkdown(result.error || "Unknown error")}`;

  if (messageId) {
    await callTelegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "MarkdownV2",
    });
  }
}

async function handleSelfEdit(
  chatId: string,
  messageId: number | undefined,
  queueId: string,
  commentId: string,
): Promise<void> {
  pendingEditState.set(chatId, `self:${queueId}:${commentId}`);
  setTimeout(() => pendingEditState.delete(chatId), 5 * 60 * 1000);

  const promptText =
    `✏️ *Edit Self\\-Reply*\n\n` +
    `Type your custom reply text and send it\\.\n` +
    `_Reply will be sent as\\-is\\._\n\n` +
    `Send /cancel to cancel\\.`;

  if (messageId) {
    await callTelegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: promptText,
      parse_mode: "MarkdownV2",
    });
  } else {
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text: promptText,
      parse_mode: "MarkdownV2",
    });
  }
}

async function handleSelfReject(
  chatId: string,
  messageId: number | undefined,
  queueId: string,
  commentId: string,
): Promise<void> {
  await selfReplyService.skipComment(queueId, commentId);

  if (messageId) {
    await callTelegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: "❌ *Rejected*\n\nThis comment has been skipped\\.",
      parse_mode: "MarkdownV2",
    });
  }
}

export async function handleTextMessage(message: {
  text?: string;
  chat: { id: number };
}): Promise<void> {
  const chatId = String(message.chat.id);
  const text = message.text || "";

  if (text.startsWith("/")) {
    if (text === "/cancel") {
      if (pendingEditState.has(chatId)) pendingEditState.delete(chatId);
      if (pendingSeedState.has(chatId)) pendingSeedState.delete(chatId);
      await callTelegram("sendMessage", {
        chat_id: chatId,
        text: "❌ Cancelled\\.",
        parse_mode: "MarkdownV2",
      });
    }
    return;
  }

  // Handle seed multi-step text input
  const seedState = pendingSeedState.get(chatId);
  if (seedState) {
    if (seedState.step === "awaiting_raw_content") {
      seedState.raw_content = text;
      seedState.step = "awaiting_post_url";
      await callTelegram("sendMessage", {
        chat_id: chatId,
        text: "📌 *Seed Post — Step 3/3*\n\nNhập URL bài post \\(x\\.com/\\.\\.\\.\\):",
        parse_mode: "MarkdownV2",
      });
      return;
    }

    if (seedState.step === "awaiting_post_url") {
      const urlPattern = /x\.com\/[^/]+\/status\/\d+/;
      if (!urlPattern.test(text)) {
        await callTelegram("sendMessage", {
          chat_id: chatId,
          text: "⚠️ URL không hợp lệ\\. Vui lòng nhập URL dạng `x\\.com/username/status/123`:",
          parse_mode: "MarkdownV2",
        });
        return;
      }

      seedState.post_url = text.startsWith("http") ? text : `https://${text}`;
      seedState.step = "awaiting_confirm";

      const confirmText =
        `📌 *Xác nhận lưu bài post?*\n\n` +
        `📌 Type: *${escapeMarkdown(seedState.content_type || "")}*\n` +
        `📝 Content: "${escapeMarkdown((seedState.raw_content || "").substring(0, 100))}${(seedState.raw_content || "").length > 100 ? "\\.\\.\\." : ""}"\n` +
        `🔗 URL: ${escapeMarkdown(seedState.post_url)}`;

      await callTelegram("sendMessage", {
        chat_id: chatId,
        text: confirmText,
        parse_mode: "MarkdownV2",
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Confirm", callback_data: "seed_confirm" },
            { text: "❌ Cancel", callback_data: "seed_cancel" },
          ]],
        },
      });
      return;
    }
  }

  const editStateValue = pendingEditState.get(chatId);
  if (!editStateValue) return;

  pendingEditState.delete(chatId);

  // Self-reply edit: value is "self:<queueId>:<commentId>"
  if (editStateValue.startsWith("self:")) {
    const [, queueId, commentId] = editStateValue.split(":");
    const result = await selfReplyService.sendReply(queueId, commentId, text);
    const responseText = result.success
      ? `✅ *Reply Queued*\n\n"${escapeMarkdown(text)}"`
      : `❌ *Failed*\n\n${escapeMarkdown(result.error || "Unknown error")}`;
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text: responseText,
      parse_mode: "MarkdownV2",
    });
    return;
  }

  // KOL suggestion edit: value is suggestionId
  const suggestion = await KolReplySuggestion.findById(editStateValue);
  if (!suggestion) {
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text: "❌ Suggestion not found\\.",
      parse_mode: "MarkdownV2",
    });
    return;
  }

  const index = suggestion.selected_suggestion_id
    ? suggestion.suggestions.findIndex((s) => s.id === suggestion.selected_suggestion_id)
    : 0;

  const result = await replyEngineService.approveSuggestion(
    editStateValue,
    index < 0 ? 0 : index,
    text,
  );

  const responseText = result.success
    ? `✅ *Reply Sent*\n\n"${escapeMarkdown(text)}"`
    : `❌ *Failed*\n\n${escapeMarkdown(result.error || "Unknown error")}`;

  await callTelegram("sendMessage", {
    chat_id: chatId,
    text: responseText,
    parse_mode: "MarkdownV2",
  });
}

async function sendSettings(chatId: string): Promise<void> {
  const settings = await KolSettings.getSettings();
  const mode = settings.default_mode;

  const text =
    `⚙️ *Current Mode: ${escapeMarkdown(mode.toUpperCase())}*\n\n` +
    (mode === EReplyMode.AFK
      ? "🤖 *AFK Mode:* Auto\\-reply based on confidence threshold\n" +
        `• Min confidence: ${escapeMarkdown(String(settings.afk.min_confidence_threshold))}%\n` +
        `• Delay: ${escapeMarkdown(String(settings.afk.auto_delay_min_minutes))}\\-${escapeMarkdown(String(settings.afk.auto_delay_max_minutes))} min`
      : "👤 *Manual Mode:* All require approval");

  await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "MarkdownV2",
  });
}

// ── Command Handlers ─────────────────────────────────────────────────────────

async function handleSeedCommand(chatId: string): Promise<void> {
  pendingSeedState.set(chatId, { step: "awaiting_content_type" });
  setTimeout(() => pendingSeedState.delete(chatId), 10 * 60 * 1000);

  await callTelegram("sendMessage", {
    chat_id: chatId,
    text: "📌 *Seed Post — Step 1/3*\n\nChọn loại bài post:",
    parse_mode: "MarkdownV2",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔥 hot_take", callback_data: "seed_type:hot_take" },
          { text: "📰 curation", callback_data: "seed_type:curation" },
        ],
        [
          { text: "📣 announcement", callback_data: "seed_type:announcement" },
          { text: "💬 engagement", callback_data: "seed_type:engagement" },
        ],
        [
          { text: "🧵 thread", callback_data: "seed_type:thread" },
          { text: "❌ Cancel", callback_data: "seed_cancel" },
        ],
      ],
    },
  });
}

export async function handleSeedCallback(
  chatId: string,
  messageId: number | undefined,
  data: string,
): Promise<void> {
  if (data === "seed_cancel") {
    pendingSeedState.delete(chatId);
    if (messageId) {
      await callTelegram("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: "❌ Seed cancelled\\.",
        parse_mode: "MarkdownV2",
      });
    }
    return;
  }

  if (data === "seed_confirm") {
    const state = pendingSeedState.get(chatId);
    if (!state || !state.content_type || !state.raw_content || !state.post_url) {
      pendingSeedState.delete(chatId);
      return;
    }

    pendingSeedState.delete(chatId);

    try {
      const existing = await Post.findOne({ post_url: state.post_url });
      if (existing) {
        if (messageId) {
          await callTelegram("editMessageText", {
            chat_id: chatId,
            message_id: messageId,
            text: "⚠️ *Đã tồn tại*\n\nBài post này đã có trong DB\\.",
            parse_mode: "MarkdownV2",
          });
        }
        return;
      }

      await Post.create({
        platform: "twitter",
        content_type: state.content_type,
        raw_content: state.raw_content,
        post_url: state.post_url,
        status: EPostStatus.POSTED,
        media: [],
        ai_stack: [],
        is_viral_candidate: false,
        external_refs: [],
        edit_history: [],
      });

      if (messageId) {
        await callTelegram("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: "✅ *Đã lưu\\!*\n\nBài post đã được seed vào DB\\.",
          parse_mode: "MarkdownV2",
        });
      }
      log.info(`[KolTelegramBot] Seeded post ${state.post_url}`);
    } catch (e: unknown) {
      log.error(`[KolTelegramBot] Seed failed: ${(e as Error).message}`);
      if (messageId) {
        await callTelegram("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: `❌ *Lỗi*\n\n${escapeMarkdown((e as Error).message)}`,
          parse_mode: "MarkdownV2",
        });
      }
    }
    return;
  }

  if (data.startsWith("seed_type:")) {
    const contentType = data.split(":")[1];
    const state = pendingSeedState.get(chatId);
    if (!state) return;

    state.content_type = contentType;
    state.step = "awaiting_raw_content";

    if (messageId) {
      await callTelegram("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: `📌 *Seed Post — Step 2/3*\n\nType: *${escapeMarkdown(contentType)}*\n\nNhập nội dung bài post:`,
        parse_mode: "MarkdownV2",
      });
    }
  }
}

async function handleSetMode(chatId: string, mode: EReplyMode): Promise<void> {
  await KolSettings.findOneAndUpdate(
    {},
    { $set: { default_mode: mode } },
    { upsert: true },
  );

  const label = mode === EReplyMode.AFK ? "🤖 AFK" : "👤 Manual";
  await callTelegram("sendMessage", {
    chat_id: chatId,
    text: `✅ *Mode changed to ${label}*`,
    parse_mode: "MarkdownV2",
  });

  log.info(`[KolTelegramBot] Mode switched to ${mode} by admin`);
}

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
    case "/seed":
      await handleSeedCommand(chatId);
      break;
    case "/afk":
      await handleSetMode(chatId, EReplyMode.AFK);
      break;
    case "/manual":
      await handleSetMode(chatId, EReplyMode.MANUAL);
      break;
    default:
      // Unknown command
      break;
  }
}

// ── Webhook Setup ─────────────────────────────────────────────────────────────

export async function setupWebhook(webhookUrl: string): Promise<void> {
  try {
    await callTelegram("setWebhook", { url: webhookUrl });
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
