/** Telegram webhook routes — handle callbacks and messages from Telegram. */
import { Router, type Request, type Response } from "express";
import {
  Post,
  EPostStatus,
  CurationSource,
  ECurationStatus,
} from "../db/index.js";
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

  const parts = data.match(
    /^(post_now|reject|edit|ai_rewrite|schedule|next_source)_(.+)$/,
  );
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
        const firstWords = draft.raw_content
          .trim()
          .split(/\s+/)
          .slice(0, 8)
          .join(" ");
        const postPrompt = `You are an AI Agent with browser access. Post this content to X (Twitter) and VERIFY it was published successfully.

BROWSER RULE: Keep ONLY ONE tab open at all times throughout ALL steps. Close any extra tabs before starting.

STEP 1 — COMPOSE & POST:
1. Close all extra tabs. Navigate to https://x.com/home in the single tab.
2. Wait until the page fully loads (tweet compose area is visible).
3. Click the post compose area and type the following content exactly:
"""
${draft.raw_content}
"""
4. Click the "Post" button ([data-testid="tweetButtonInline"]).
5. Wait 5 seconds. If an error banner appears (e.g. "Something went wrong"), report POST_FAILED: error banner shown and stop.

STEP 2 — VERIFY BY CLICKING INTO THE POST:
6. In the SAME tab, navigate to https://x.com/${xUser}
7. Wait until the profile page fully loads and the first tweet article is visible.
8. Click on the FIRST <article> (the most recent tweet) to open its detail page — do NOT open in new tab.
9. Wait until the post detail page fully loads.
10. Take a browser.snapshot and verify:
    CHECK A (Content): The post text on this detail page must START WITH or CONTAIN: "${firstWords}"
    CHECK B (Time): The <time> element must show a timestamp within the last 3 minutes.
11. If BOTH checks pass:
    - Read the current browser URL (it should match /${xUser}/status/<id>).
    - Report on its own line: POST_SUCCESS_VERIFIED: <current_browser_url>
12. If EITHER check fails:
    - Report on its own line: POST_FAILED: <reason>`;

        const result = runOpenClaw(postPrompt);
        const postUrlMatch = result.match(
          /POST_SUCCESS_VERIFIED:\s*(https?:\/\/\S+)/,
        );
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
              log.info(
                `CurationSource ${draft.curation_source_id} marked as used`,
              );
            } catch (csErr: any) {
              log.error(
                `Failed to update CurationSource status: ${csErr.message}`,
              );
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
      await telegramService.answerCallback(
        callbackId,
        "🔄 Đang tìm nguồn khác...",
      );

      if (chatId && callbackMessageId) {
        try {
          await telegramService.removeMessageButtons(chatId, callbackMessageId);
        } catch {
          /* ignore */
        }
      }

      await telegramService.sendMessage(
        `🔄 Draft đã bị reject. Đang tạo draft mới từ nguồn tiếp theo...`,
        chatId,
      );

      // IMPORTANT: Must use spawn (non-blocking) NOT execSync.
      // execSync blocks the entire Node.js event loop — the OpenClaw agent
      // then calls back POST /api/content-review/drafts on this same server,
      // which cannot respond because the event loop is frozen → silent deadlock.
      const escaped = DRAFT_PROMPT.replace(/'/g, "'\\''");
      const child = spawn(
        "bash",
        [
          "-c",
          `openclaw agent --agent ${settings.openClawAgent} --message '${escaped}'`,
        ],
        { detached: true, stdio: ["ignore", "ignore", "ignore"] },
      );
      child.on("error", (err) => {
        log.error(`OpenClaw spawn error (NEXT_SOURCE): ${err.message}`);
        telegramService
          .sendMessage(`❌ Lỗi tạo draft mới: ${err.message}`, chatId!)
          .catch(console.error);
      });
      child.unref(); // detach from parent process
      log.info(
        `Spawned OpenClaw DRAFT agent (pid: ${child.pid}) for NEXT_SOURCE`,
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
    const aiPrompt = `You are rewriting a social media post for X (Twitter) as a tech CEO / AI filmmaker.

Current content:
"""
${draft.raw_content}
"""

User instruction: ${aiInstruction}

Writing rules:
- UNDER 280 characters.
- NO generic openers: Do NOT use "AI is changing...", "The future is here...", or "Check out this...".
- Start with a Punch: Lead with a direct technical observation or a "hot take" on the production workflow.
- Language Style: Use founder slang (e.g., "RIP my VFX budget", "temporal consistency is finally usable", "vibe", "pre-viz", "POV", "latent space").
- Blacklisted words: Absolutely NO: revolutionizing, game-changer, delve, unleash, testament, incredible, groundbreaking.
- Include the source reference if there was one in the original.
- End with an open question or forward-looking statement to invite engagement.
- Do NOT mention Cinee or promote any product.
- Tone: personal, direct, visionary — like a real founder's tweet, not a press release.
- Output ONLY the rewritten post, nothing else.`;

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
