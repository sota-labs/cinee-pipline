# Phase 4: Telegram Manual Mode Notification

**Status:** Pending
**Priority:** Medium — completes the manual-mode branch
**Depends on:** Phase 3 (sendReply() must be real before Telegram can call it)

## Context Links

- Spec: `plans/reports/spec-260518-self-reply-trigger.md` §5 (Manual branch)
- Telegram bot: `src/telegram/kolTelegramBotNative.ts`
- selfReplyService: `src/services/selfReplyService.ts`

## Overview

Two changes:
1. `kolTelegramBotNative.ts` — add `sendSelfReplyConfirmation()` function and three callback handlers (`self_confirm`, `self_edit`, `self_reject`). Update `handleTextMessage()` to handle the self-edit flow.
2. `selfReplyService.ts` — update `storeForManualReview()` to call `sendSelfReplyConfirmation()` after saving.

## File Ownership

- `src/telegram/kolTelegramBotNative.ts`
- `src/services/selfReplyService.ts`

## Requirements

### Functional

**`sendSelfReplyConfirmation(queueId, commentId)` in `kolTelegramBotNative.ts`**
- Fetch `SelfReplyQueue` by `queueId`; return null if not found
- Fetch `Post` by `queue.our_post_id`; return null if not found
- Find the comment in `queue.pending_comments` by `commentId`; return null if not found
- Format message (see Message Format below)
- Send via `callTelegram("sendMessage", ...)` with inline keyboard
- Return the sent message result or null on error

**Callback handlers in `handleCallbackQuery()`**
- `self_confirm:<queueId>:<commentId>` → fetch `reply_content` from queue comment → call `selfReplyService.sendReply()` → edit message to show result
- `self_edit:<queueId>:<commentId>` → store `self:<queueId>:<commentId>` in `pendingEditState` with 5-min timeout → edit message to prompt for new text
- `self_reject:<queueId>:<commentId>` → call `selfReplyService.skipComment()` → edit message to show rejected

**`handleTextMessage()` update**
- After checking `pendingEditState.has(chatId)`, check if the stored value starts with `self:`
- If `self:` prefix: parse `queueId` and `commentId` from the value, call `selfReplyService.sendReply(queueId, commentId, text)`, show result
- If no `self:` prefix: existing KOL edit flow (unchanged)

**`storeForManualReview()` update in `selfReplyService.ts`**
- After saving `comment.reply_content`, call `sendSelfReplyConfirmation(queueId, commentId)` (imported from `kolTelegramBotNative.ts`)
- Import must be lazy or use dynamic import to avoid circular dependency (selfReplyService ← kolTelegramBotNative ← selfReplyService)
- Preferred approach: pass the notification function as a parameter OR use a dynamic `import()` inside the method

## Message Format

```
💬 Reply to comment on your post

📝 Post: <post.raw_content first 100 chars>...
👤 @<comment.author_handle>: "<comment.content>"

🤖 Reply: "<comment.reply_content>"
```

Keyboard:
```
[✅ Confirm]  [✏️ Edit]  [❌ Reject]
```

Callback data:
- `self_confirm:<queueId>:<commentId>`
- `self_edit:<queueId>:<commentId>`
- `self_reject:<queueId>:<commentId>`

All text must be escaped with `escapeMarkdown()` before sending with `parse_mode: "MarkdownV2"`.

## Circular Dependency Resolution

`selfReplyService.ts` imports from `kolTelegramBotNative.ts`, but `kolTelegramBotNative.ts` imports `selfReplyService` for the callback handlers. This creates a circular import.

**Solution:** Use a dynamic import inside `storeForManualReview()`:

```typescript
private async storeForManualReview(
  queueId: string,
  commentId: string,
  replyContent: string,
): Promise<void> {
  const queue = await SelfReplyQueue.findById(queueId);
  if (!queue) return;

  const comment = queue.pending_comments.find((c) => c.comment_id === commentId);
  if (comment) {
    comment.reply_content = replyContent;
    await queue.save();
  }

  log.info(`[SelfReply] Stored reply for manual review — comment ${commentId}`);

  // Notify via Telegram (dynamic import avoids circular dependency)
  try {
    const { sendSelfReplyConfirmation } = await import("../telegram/kolTelegramBotNative.js");
    await sendSelfReplyConfirmation(queueId, commentId);
  } catch (e: unknown) {
    log.error(`[SelfReply] Failed to send Telegram notification: ${(e as Error).message}`);
  }
}
```

## Implementation Steps

### 1. `src/telegram/kolTelegramBotNative.ts` — add imports

Add to existing imports:
```typescript
import { SelfReplyQueue } from "../db/index.js";
import { Post } from "../db/index.js";
import { selfReplyService } from "../services/selfReplyService.js";
```

Note: `SelfReplyQueue` and `Post` are already exported from `../db/index.js`.

### 2. `src/telegram/kolTelegramBotNative.ts` — add `sendSelfReplyConfirmation()`

Add after `sendAFKNotification()`:

```typescript
export async function sendSelfReplyConfirmation(
  queueId: string,
  commentId: string,
): Promise<{ message_id: number } | null> {
  const chatId = getAdminChatId();
  if (!chatId) {
    log.error("[KolTelegramBot] TELEGRAM_ADMIN_CHAT_ID not configured");
    return null;
  }

  const queue = await SelfReplyQueue.findById(queueId);
  if (!queue) return null;

  const post = await Post.findById(queue.our_post_id);
  if (!post) return null;

  const comment = queue.pending_comments.find((c) => c.comment_id === commentId);
  if (!comment || !comment.reply_content) return null;

  const postPreview = post.raw_content.substring(0, 100);
  const hasMore = post.raw_content.length > 100;

  let text = `💬 *Reply to comment on your post*\n\n`;
  text += `📝 *Post:* ${escapeMarkdown(postPreview)}${hasMore ? "\\.\\.\\." : ""}\n`;
  text += `👤 @${escapeMarkdown(comment.author_handle)}: "${escapeMarkdown(comment.content)}"\n\n`;
  text += `🤖 *Reply:* "${escapeMarkdown(comment.reply_content)}"`;

  const keyboard = {
    inline_keyboard: [[
      { text: "✅ Confirm", callback_data: `self_confirm:${queueId}:${commentId}` },
      { text: "✏️ Edit", callback_data: `self_edit:${queueId}:${commentId}` },
      { text: "❌ Reject", callback_data: `self_reject:${queueId}:${commentId}` },
    ]],
  };

  try {
    const result = await callTelegram("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "MarkdownV2",
      reply_markup: keyboard,
    });
    log.info(`[KolTelegramBot] Sent self-reply confirmation for comment ${commentId}`);
    return result;
  } catch (error) {
    log.error(`[KolTelegramBot] Failed to send self-reply confirmation: ${(error as Error).message}`);
    return null;
  }
}
```

### 3. `src/telegram/kolTelegramBotNative.ts` — add callback handlers

In `handleCallbackQuery()`, add three new branches after the existing `kol_settings` branch:

```typescript
} else if (data.startsWith("self_confirm:")) {
  const [, queueId, commentId] = data.split(":");
  await handleSelfConfirm(chatId, messageId, queueId, commentId);
} else if (data.startsWith("self_edit:")) {
  const [, queueId, commentId] = data.split(":");
  await handleSelfEdit(chatId, messageId, queueId, commentId);
} else if (data.startsWith("self_reject:")) {
  const [, queueId, commentId] = data.split(":");
  await handleSelfReject(chatId, messageId, queueId, commentId);
}
```

Add the three handler functions (private, not exported):

```typescript
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
    ? "✅ *Confirmed*\n\nReply queued for execution\\."
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
  // Store as "self:<queueId>:<commentId>" to distinguish from KOL edit
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
      text: "❌ *Rejected*\n\nComment skipped\\.",
      parse_mode: "MarkdownV2",
    });
  }
}
```

### 4. `src/telegram/kolTelegramBotNative.ts` — update `handleTextMessage()`

Replace the `pendingEditState` handling block in `handleTextMessage()`:

Current logic (simplified):
```typescript
const suggestionId = pendingEditState.get(chatId);
if (!suggestionId) return;
pendingEditState.delete(chatId);
// ... KOL edit flow
```

New logic:
```typescript
const editStateValue = pendingEditState.get(chatId);
if (!editStateValue) return;
pendingEditState.delete(chatId);

// Self-reply edit flow
if (editStateValue.startsWith("self:")) {
  const [, queueId, commentId] = editStateValue.split(":");
  const result = await selfReplyService.sendReply(queueId, commentId, text);
  const responseText = result.success
    ? `✅ *Reply Sent*\n\n"${escapeMarkdown(text)}"`
    : `❌ *Failed*\n\n${escapeMarkdown(result.error || "Unknown error")}`;
  await callTelegram("sendMessage", {
    chat_id: chatId,
    text: responseText,
    parse_mode: "MarkdownV2",
  });
  return;
}

// KOL edit flow (existing code, unchanged)
const suggestionId = editStateValue;
const suggestion = await KolReplySuggestion.findById(suggestionId);
// ... rest of existing KOL edit logic
```

### 5. `src/services/selfReplyService.ts` — update `storeForManualReview()`

Replace the current `storeForManualReview()` body with the dynamic-import version shown in the Circular Dependency Resolution section above.

## Todo

- [ ] Add `SelfReplyQueue`, `Post` imports to `kolTelegramBotNative.ts`
- [ ] Add `selfReplyService` import to `kolTelegramBotNative.ts`
- [ ] Add `sendSelfReplyConfirmation()` exported function
- [ ] Add `handleSelfConfirm()`, `handleSelfEdit()`, `handleSelfReject()` private functions
- [ ] Add `self_confirm/edit/reject` branches in `handleCallbackQuery()`
- [ ] Update `handleTextMessage()` to handle `self:` prefix in `pendingEditState`
- [ ] Update `storeForManualReview()` in `selfReplyService.ts` with dynamic import
- [ ] Run `npm run typecheck` — confirm no errors

## Success Criteria

- `tsc` passes
- When `processSelfReplyResult()` runs in manual mode, a Telegram message is sent with 3 buttons
- Clicking Confirm calls `sendReply()` and edits the message to show success
- Clicking Edit prompts for text; sending text calls `sendReply()` with the new content
- Clicking Reject calls `skipComment()` and edits the message to show rejected
- KOL edit flow (existing) is unaffected

## Risk Assessment

- Medium — circular dependency is the main risk; dynamic import resolves it cleanly
- `pendingEditState` value format change (`self:` prefix) is backward-compatible — existing KOL values never start with `self:`
