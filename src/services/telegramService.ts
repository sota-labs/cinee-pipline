/** Telegram Bot service — send drafts for review and handle interactions.
 *
 * Uses Telegram Bot HTTP API directly (no extra dependencies).
 */
import * as https from "https";
import { log } from "../utils/logger.js";
import { settings } from "../config/settings.js";

// ── Low-level API helpers ────────────────────────────────────────────────────

function getBotToken() {
  return settings.cineeTelegramBotToken || process.env.TELEGRAM_BOT_TOKEN || "";
}

function getTelegramApi() {
  return `/bot${getBotToken()}`;
}

async function callTelegram(
  method: string,
  body: Record<string, unknown>,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const dataStr = JSON.stringify(body);
    const options = {
      hostname: "api.telegram.org",
      port: 443,
      path: `${getTelegramApi()}/${method}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(dataStr),
      },
      family: 4, // Force IPv4
    };

    const req = https.request(options, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => (responseBody += chunk));
      res.on("end", () => {
        try {
          const data = JSON.parse(responseBody);
          if (!data.ok) {
            log.error(`Telegram API error [${method}]: ${responseBody}`);
            return reject(
              new Error(`Telegram ${method} failed: ${data.description}`),
            );
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

function buildDraftKeyboard(draftId: string) {
  return {
    inline_keyboard: [
      [
        { text: "🚀 Post now", callback_data: `post_now_${draftId}` },
        { text: "❌ Reject", callback_data: `reject_${draftId}` },
      ],
      [
        { text: "✏️ Edit", callback_data: `edit_${draftId}` },
        { text: "🤖 AI Rewrite", callback_data: `ai_rewrite_${draftId}` },
      ],
      [
        { text: "⏰ Schedule", callback_data: `schedule_${draftId}` },
        { text: "🔄 Choose another source", callback_data: `next_source_${draftId}` },
      ],
    ],
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function sendDraftForReview(
  draftId: string,
  content: string,
  researchSource: string,
  chatId = settings.telegramChatId || process.env.TELEGRAM_CHAT_ID || "",
): Promise<{ message_id: number }> {
  const text = [
    "📝 *Bài viết mới cần duyệt:*\n",
    escapeMarkdown(content),
    `\n🔗 *Source:* ${escapeMarkdown(researchSource)}`,
    `\n_Draft ID: \`${escapeMarkdown(draftId)}\`_`,
  ].join("\n");

  const keyboard = buildDraftKeyboard(draftId);

  const result = await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "MarkdownV2",
    reply_markup: keyboard,
  });

  log.info(
    `Sent draft ${draftId} to Telegram chat ${chatId} (msg_id: ${result.message_id})`,
  );
  return result;
}

/** Send updated draft preview after edit. */
export async function sendUpdatedPreview(
  draftId: string,
  content: string,
  version: number,
  chatId = settings.telegramChatId || process.env.TELEGRAM_CHAT_ID || "",
): Promise<{ message_id: number }> {
  const text = [
    `📝 *Bản cập nhật \\#${version}:*\n`,
    escapeMarkdown(content),
    `\n_Draft ID: \`${escapeMarkdown(draftId)}\`_`,
  ].join("\n");

  const keyboard = buildDraftKeyboard(draftId);

  return callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "MarkdownV2",
    reply_markup: keyboard,
  });
}

/** Send a plain text message (no parse mode to avoid formatting issues). */
export async function sendMessage(
  text: string,
  chatId = settings.telegramChatId || process.env.TELEGRAM_CHAT_ID || "",
): Promise<{ message_id: number }> {
  return callTelegram("sendMessage", {
    chat_id: chatId,
    text,
  });
}

/** Remove all inline buttons from a message (marks it as finalized). */
export async function removeMessageButtons(
  chatId: string,
  messageId: number,
): Promise<void> {
  await callTelegram("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}

/** Answer a callback query (dismiss the "loading" spinner on buttons). */
export async function answerCallback(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await callTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text || "OK",
  });
}

/** Register a webhook URL with Telegram. */
export async function setupWebhook(webhookUrl: string): Promise<unknown> {
  return callTelegram("setWebhook", { url: webhookUrl });
}

/** Remove the webhook and optionally drop pending updates. */
export async function removeWebhook(
  dropPendingUpdates = false,
): Promise<unknown> {
  return callTelegram("deleteWebhook", {
    drop_pending_updates: dropPendingUpdates,
  });
}

/** Get current webhook info. */
export async function getWebhookInfo(): Promise<unknown> {
  return callTelegram("getWebhookInfo", {});
}

/** Check if the bot token is configured. */
export function isConfigured(): boolean {
  return (
    getBotToken().length > 0 &&
    (settings.telegramChatId || process.env.TELEGRAM_CHAT_ID || "").length > 0
  );
}
