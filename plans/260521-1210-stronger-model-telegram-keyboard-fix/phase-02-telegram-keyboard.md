# Phase 02 — Telegram Keyboard Removal on Success

## Context Links
- `src/telegram/kolTelegramBotNative.ts` — All affected handlers

## Overview

- **Priority:** P2
- **Status:** Completed
- **Description:** On successful approve/reject, remove inline keyboard buttons using `editMessageReplyMarkup` instead of replacing message text. On error, do nothing (keep buttons). Edit/SelfEdit handlers keep current behavior.

## Key Insights

- Telegram API: `editMessageReplyMarkup` with `reply_markup: { inline_keyboard: [] }` removes all buttons while preserving message text.
- Current behavior: `editMessageText` replaces entire message content with "✅ Approved" / "❌ Rejected" text.
- Target behavior: message text stays as-is, buttons disappear on success.
- On error: no edit at all — user can retry.

## Affected Handlers

| Handler | Current | New (success) | New (error) |
|---------|---------|---------------|-------------|
| `handleApprove` | editMessageText → "✅ Approved..." | editMessageReplyMarkup (remove buttons) | no edit |
| `handleReject` | editMessageText → "❌ Rejected..." | editMessageReplyMarkup (remove buttons) | no edit |
| `handleConfirmApprove` | editMessageText → "✅ Confirmed..." | editMessageReplyMarkup (remove buttons) | no edit |
| `handleSelfConfirm` | editMessageText → "✅ Confirmed..." | editMessageReplyMarkup (remove buttons) | no edit |
| `handleSelfReject` | editMessageText → "❌ Rejected..." | editMessageReplyMarkup (remove buttons) | no edit |
| `handleEdit` | editMessageText → edit prompt | unchanged | — |
| `handleSelfEdit` | editMessageText → edit prompt | unchanged | — |

## Related Code Files

- **Modify:** `/home/sotatek/Documents/cinee-openclaw/cinee-pipline/src/telegram/kolTelegramBotNative.ts`

## Implementation Steps

### Helper pattern to use in each success handler

```typescript
if (messageId) {
  await callTelegram("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}
```

### 1. `handleApprove`

Replace current block:
```typescript
const text = result.success
  ? "✅ *Approved and Sent*\n\nReply has been posted successfully\\."
  : `❌ *Approval Failed*\n\nError: ${escapeMarkdown(result.error || "Unknown error")}`;

if (messageId) {
  await callTelegram("editMessageText", { ... });
}
```

With:
```typescript
if (result.success && messageId) {
  await callTelegram("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}
// On error: do nothing, keep buttons
```

### 2. `handleReject`

Replace:
```typescript
if (messageId) {
  await callTelegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: "❌ *Rejected*\n\nThis suggestion has been rejected\\.",
    parse_mode: "MarkdownV2",
  });
}
```

With:
```typescript
if (messageId) {
  await callTelegram("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}
```
(reject always succeeds — `rejectSuggestion` has no return value to check)

### 3. `handleConfirmApprove`

- Error path (suggestion not found): keep `editMessageText` with error message — this is a system error, not a user action result, so showing error text is appropriate.
- Success path: replace `editMessageText` with `editMessageReplyMarkup`.
- Failure path (`!result.success`): do nothing (keep buttons).

```typescript
const result = await replyEngineService.approveSuggestion(suggestionId, index);

if (result.success && messageId) {
  await callTelegram("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}
// On failure: keep buttons
```

### 4. `handleSelfConfirm`

Same pattern as `handleConfirmApprove`:
- System error (content not found): keep `editMessageText` error.
- Success: `editMessageReplyMarkup`.
- Failure: no edit.

### 5. `handleSelfReject`

Same as `handleReject` — always succeeds, just remove keyboard:
```typescript
if (messageId) {
  await callTelegram("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}
```

## Todo List

- [x] Update `handleApprove`: remove keyboard on success, no edit on error
- [x] Update `handleReject`: remove keyboard (always succeeds)
- [x] Update `handleConfirmApprove`: remove keyboard on success, no edit on failure, keep error text for system errors
- [x] Update `handleSelfConfirm`: remove keyboard on success, no edit on failure, keep error text for system errors
- [x] Update `handleSelfReject`: remove keyboard (always succeeds)
- [x] Run `tsc --noEmit` to verify no type errors

## Success Criteria

- After approve/reject: message text unchanged, buttons gone
- After failed approve: message unchanged, buttons still visible for retry
- `handleEdit` / `handleSelfEdit`: behavior unchanged
- `tsc --noEmit` passes

## Risk Assessment

- Low risk — UI-only change, no business logic affected
- `editMessageReplyMarkup` is a standard Telegram Bot API method, same `callTelegram` wrapper used throughout
