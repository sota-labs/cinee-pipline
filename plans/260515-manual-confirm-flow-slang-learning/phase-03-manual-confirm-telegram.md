# Phase 03 — Manual Confirm Telegram Bot

**Priority:** High
**Status:** Pending

---

## Context Links

- Telegram bot: `src/telegram/kolTelegramBotNative.ts`
- Existing review function: `sendSuggestionForReview()` (line 117)
- Existing callback handler: `handleCallbackQuery()` (line 308)

---

## Overview

Add a streamlined confirmation UI to Telegram. When the system pre-selects a suggestion, send a simple message with the reply content and Confirm/Reject/See All buttons.

---

## Implementation Steps

### 1. Add `sendConfirmationRequest()` function

```typescript
/**
 * Send a streamlined confirmation for a pre-selected suggestion.
 * Simpler than sendSuggestionForReview — shows only the chosen reply.
 */
export async function sendConfirmationRequest(
  suggestion: IKolReplySuggestion,
): Promise<{ message_id: number } | null> {
  const chatId = getAdminChatId();
  if (!chatId) return null;

  const post = await KolPost.findById(suggestion.kol_post_id).populate("kol_id");
  if (!post) return null;

  const kol = post.kol_id as unknown as { handle: string };
  const handle = kol?.handle || "unknown";

  // Find the pre-selected suggestion
  const selected = suggestion.suggestions.find(
    (s) => s.id === suggestion.selected_suggestion_id,
  );
  if (!selected) return null;

  let text = `🤖 *Reply to @${escapeMarkdown(handle)}*\n\n`;
  text += `📝 *Post:* ${escapeMarkdown(post.content.substring(0, 150))}${post.content.length > 150 ? "..." : ""}\n\n`;
  text += `💬 *Reply:* "${escapeMarkdown(selected.content)}"\n`;
  text += `📊 Confidence: ${selected.confidence}% \\| Tone: ${escapeMarkdown(selected.tone)}\n\n`;
  text += `⏱ _Auto\\-reject in 1 hour_`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ Confirm", callback_data: `kol_confirm:${suggestion._id}` },
        { text: "❌ Reject", callback_data: `kol_confirm_reject:${suggestion._id}` },
      ],
      [
        { text: "🔄 See All Options", callback_data: `kol_confirm_all:${suggestion._id}` },
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

    return result;
  } catch (error) {
    log.error(`[KolTelegramBot] Failed to send confirmation: ${(error as Error).message}`);
    return null;
  }
}
```

### 2. Add callback handlers

In `handleCallbackQuery()`, add cases:

```typescript
} else if (data.startsWith("kol_confirm:")) {
  const [, suggestionId] = data.split(":");
  await handleConfirmApprove(chatId, messageId, suggestionId);
} else if (data.startsWith("kol_confirm_reject:")) {
  const [, suggestionId] = data.split(":");
  await handleReject(chatId, messageId, suggestionId); // reuse existing
} else if (data.startsWith("kol_confirm_all:")) {
  const [, suggestionId] = data.split(":");
  await handleShowAll(chatId, messageId, suggestionId);
}
```

### 3. Implement `handleConfirmApprove()`

```typescript
async function handleConfirmApprove(
  chatId: string,
  messageId: number | undefined,
  suggestionId: string,
): Promise<void> {
  const suggestion = await KolReplySuggestion.findById(suggestionId);
  if (!suggestion || !suggestion.selected_suggestion_id) return;

  // Find index of pre-selected suggestion
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
```

### 4. Implement `handleShowAll()`

```typescript
async function handleShowAll(
  chatId: string,
  messageId: number | undefined,
  suggestionId: string,
): Promise<void> {
  const suggestion = await KolReplySuggestion.findById(suggestionId);
  if (!suggestion) return;

  // Remove the confirmation message
  if (messageId) {
    try {
      await callTelegram("deleteMessage", { chat_id: chatId, message_id: messageId });
    } catch { /* ignore */ }
  }

  // Send full suggestion list (existing function)
  await sendSuggestionForReview(suggestion);
}
```

---

## Done When

- [ ] `sendConfirmationRequest()` sends streamlined message with Confirm/Reject/See All
- [ ] `kol_confirm:` callback approves pre-selected suggestion
- [ ] `kol_confirm_reject:` callback rejects
- [ ] `kol_confirm_all:` callback shows full list
- [ ] Messages display correctly in Telegram (MarkdownV2 escaping)
- [ ] `npx tsc --noEmit` passes
