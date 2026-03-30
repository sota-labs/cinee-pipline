/** Telegram webhook routes — handle callbacks and messages from Telegram. */
import { Router, type Request, type Response } from "express";
import { Post, EPostStatus, CurationSource, ECurationStatus } from "../db/index.js";
import * as telegramService from "../services/telegramService.js";
import { log } from "../utils/logger.js";
import { execSync, spawn } from "child_process";
import { settings } from "../config/settings.js";
import { DRAFT_PROMPT } from "../services/schedulerService.js";

export const telegramRouter = Router();
enum EPendingAction {
  EDIT = "edit",
  SCHEDULE = "schedule",
  AI_PROMPT = "ai_prompt",
}

enum EAgentAction {
  POST_NOW = "post_now",
  REJECT = "reject",
  EDIT = "edit",
  AI_REWRITE = "ai_rewrite",
  SCHEDULE = "schedule",
  NEXT_SOURCE = "next_source",
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
      timeout: 300_000,
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

  const parts = data.match(/^(post_now|reject|edit|ai_rewrite|schedule|next_source)_(.+)$/);
  if (!parts) {
    await telegramService.answerCallback(callbackId, "❓ Unknown action");
    return;
  }

  const [, action, draftId] = parts;
  const callbackMessageId: number | undefined = query.message?.message_id;
  const draft = await Post.findById(draftId);

  if (!draft) {
    await telegramService.answerCallback(callbackId, "❌ Draft not found");
    return;
  }

  if (draft.status === EPostStatus.POSTED) {
    await telegramService.answerCallback(
      callbackId,
      "📌 Bài này đã được đăng rồi",
    );
    return;
  }

  switch (action) {
    case EAgentAction.POST_NOW: {
      await telegramService.answerCallback(callbackId, "🚀 Đang đăng bài...");
      await telegramService.sendMessage(
        `🚀 Đang đăng bài lên X, chờ chút...`,
        chatId,
      );

      try {
        const xUser = settings.xUsername;
        const firstWords = draft.raw_content.trim().split(/\s+/).slice(0, 8).join(" ");
        const postPrompt = `You are an AI Agent with browser access. Post this content to X (Twitter) and VERIFY it was published successfully.

STEP 1 — COMPOSE & POST:
1. Navigate to https://x.com/home
2. Wait until the page fully loads (tweet compose area is visible).
3. Click the post compose area and type the following content exactly:
"""
${draft.raw_content}
"""
4. Click the "Post" button ([data-testid="tweetButtonInline"]).
5. Wait 5 seconds. If an error banner appears (e.g. "Something went wrong"), report POST_FAILED: error banner shown and stop.

STEP 2 — VERIFY THE POST WAS PUBLISHED:
6. Navigate to https://x.com/${xUser}
7. Wait until the profile page fully loads and the first tweet is visible.
8. Take a browser.snapshot and inspect the FIRST <article> on the page:
   a) Read its tweet text content.
   b) Read its timestamp from the <time> element. Convert to an absolute time if shown as relative (e.g. "2m" = 2 minutes ago).
9. VERIFICATION CHECKS — both must pass:
   CHECK A (Content match): The first tweet's text must START WITH or CONTAIN the following words: "${firstWords}"
   CHECK B (Time match): The timestamp of the first tweet must be within the last 3 minutes from now.
10. If BOTH checks pass:
    - Find the <a> tag that wraps the <time> element. Build the full URL: https://x.com + href.
    - Report on its own line: POST_SUCCESS_VERIFIED: <full_post_url>
11. If EITHER check fails:
    - Report on its own line: POST_FAILED: <reason — e.g. "content mismatch" or "timestamp too old (was: X minutes ago)">`;

        const result = runOpenClaw(postPrompt);
        const postUrlMatch = result.match(/POST_SUCCESS_VERIFIED:\s*(https?:\/\/\S+)/);
        const postFailMatch = result.match(/POST_FAILED:\s*(.+)/);
        if (postUrlMatch) {
          draft.status = EPostStatus.POSTED;
          draft.post_url = postUrlMatch[1];
          await draft.save();

          // Mark the CurationSource as "used" now that the post is live
          if (draft.curation_source_id) {
            try {
              await CurationSource.findByIdAndUpdate(draft.curation_source_id, {
                $set: { status: ECurationStatus.USED, posted_at: new Date() },
              });
              log.info(`CurationSource ${draft.curation_source_id} marked as used`);
            } catch (csErr: any) {
              log.error(`Failed to update CurationSource status: ${csErr.message}`);
            }
          }

          if (chatId && callbackMessageId) {
            await telegramService.removeMessageButtons(
              chatId,
              callbackMessageId,
            );
          }

          const urlInfo = `\n\n🔗 ${draft.post_url}`;
          await telegramService.sendMessage(
            `✅ Đã đăng bài thành công!${urlInfo}\n\nNội dung:\n${draft.raw_content}`,
            chatId,
          );
        } else if (postFailMatch) {
          const reason = postFailMatch[1].trim();
          log.error(`Post verification failed: ${reason}`);
          draft.status = EPostStatus.FAILED;
          await draft.save();
          await telegramService.sendMessage(
            `❌ Đăng bài thất bại (xác minh không qua):\n${reason}\n\nNội dung:\n${draft.raw_content}`,
            chatId,
          );
        } else {
          log.error(`OpenClaw agent returned unexpected output: ${result}`);
          await telegramService.sendMessage(
            `⚠️ Không xác minh được kết quả đăng bài. Kiểm tra thủ công trên X.\n\nAgent output:\n${result.slice(0, 300)}`,
            chatId,
          );
        }
      } catch (err: any) {
        log.error(`Post to X failed: ${err.message}`);
        await telegramService.sendMessage(
          `❌ Đăng bài thất bại: ${err.message}`,
          chatId,
        );
        draft.status = EPostStatus.FAILED;
        await draft.save();
      }
      break;
    }

    case EAgentAction.REJECT: {
      draft.status = EPostStatus.REJECTED;
      await draft.save();
      await telegramService.answerCallback(callbackId, "❌ Rejected");

      if (chatId && callbackMessageId) {
        try {
          await telegramService.removeMessageButtons(chatId, callbackMessageId);
        } catch {
          /* non-critical */
        }
      }

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

    case EAgentAction.NEXT_SOURCE: {
      draft.status = EPostStatus.REJECTED;
      await draft.save();
      await telegramService.answerCallback(callbackId, "🔄 Đang tìm nguồn khác...");

      if (chatId && callbackMessageId) {
        try {
          await telegramService.removeMessageButtons(chatId, callbackMessageId);
        } catch {
          /* ignore */
        }
      }

      await telegramService.sendMessage(`🔄 Draft đã bị reject. Đang tạo draft mới từ nguồn tiếp theo...`, chatId);

      // IMPORTANT: Must use spawn (non-blocking) NOT execSync.
      // execSync blocks the entire Node.js event loop — the OpenClaw agent
      // then calls back POST /api/content-review/drafts on this same server,
      // which cannot respond because the event loop is frozen → silent deadlock.
      const escaped = DRAFT_PROMPT.replace(/'/g, "'\\''" );
      const child = spawn(
        "bash",
        ["-c", `openclaw agent --agent ${settings.openClawAgent} --message '${escaped}'`],
        { detached: true, stdio: ["ignore", "ignore", "ignore"] },
      );
      child.on("error", (err) => {
        log.error(`OpenClaw spawn error (NEXT_SOURCE): ${err.message}`);
        telegramService.sendMessage(`❌ Lỗi tạo draft mới: ${err.message}`, chatId!).catch(console.error);
      });
      child.unref(); // detach from parent process
      log.info(`Spawned OpenClaw DRAFT agent (pid: ${child.pid}) for NEXT_SOURCE`);
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
      await handleEdit(pending, text, chatId);
      break;
    case EPendingAction.AI_PROMPT:
      await handleAiPrompt(pending, text, chatId);
      break;
    case EPendingAction.SCHEDULE:
      await handleSchedule(pending, text, chatId);
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
- Keep it under 300 characters
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
