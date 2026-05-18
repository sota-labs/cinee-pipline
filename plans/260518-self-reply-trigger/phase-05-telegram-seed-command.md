# Phase 5: /seed Telegram Command

**Status:** Pending
**Priority:** Medium — enables manual post seeding without raw API calls
**Depends on:** Phase 4 (must complete first — both own `kolTelegramBotNative.ts`)

## Context Links

- Spec: `plans/reports/spec-260518-self-reply-trigger.md` §/seed
- Telegram bot: `src/telegram/kolTelegramBotNative.ts`
- Post model: `src/db/models/Post.ts`

## Overview

Add a `/seed` command to the Telegram bot that walks the user through a multi-step conversation to seed a post into the `Post` collection. Uses an in-memory state machine (`pendingSeedState`) similar to `pendingEditState`.

## File Ownership

- `src/telegram/kolTelegramBotNative.ts`

## Requirements

### Functional

**State machine**
- `pendingSeedState = new Map<string, ISeedState>()` — chatId → state
- 10-minute timeout per entry
- Steps: `awaiting_content_type` → `awaiting_raw_content` → `awaiting_post_url` → `awaiting_confirm`

**`/seed` command**
- Send inline keyboard with 5 content_type buttons
- Set state to `{ step: "awaiting_content_type" }`

**`seed_type:<type>` callback**
- Update state: `content_type = type`, `step = "awaiting_raw_content"`
- Send message: "Enter the post content:"

**Text message handling (seed flow)**
- `awaiting_raw_content`: validate non-empty → save `raw_content`, advance to `awaiting_post_url`, prompt for URL
- `awaiting_post_url`: validate `x.com/.+/status/\d+` pattern → check duplicate `Post.findOne({ post_url })` → if duplicate: send error, stay on same step → if valid: save `post_url`, advance to `awaiting_confirm`, send confirmation message with `[✅ Confirm] [❌ Cancel]` keyboard

**`seed_confirm` callback**
- `Post.create({ content_type, raw_content, post_url, status: EPostStatus.POSTED, platform: "twitter", media: [], ai_stack: [], is_viral_candidate: false, external_refs: [], edit_history: [] })`
- Clear state
- Send "✅ Post saved."

**`seed_cancel` callback**
- Clear state
- Send "❌ Cancelled."

### Non-functional
- 10-minute timeout clears state automatically
- Validation errors prompt the user to retry (state stays on same step)
- `/cancel` command clears seed state (same as edit state)

## State Machine

```
/seed
  → pendingSeedState[chatId] = { step: "awaiting_content_type" }
  → send content_type keyboard

seed_type:<type>
  → state.content_type = type
  → state.step = "awaiting_raw_content"
  → "Enter the post content:"

[user sends text]
  awaiting_raw_content:
    → state.raw_content = text
    → state.step = "awaiting_post_url"
    → "Enter the post URL (x.com/...):"

  awaiting_post_url:
    → validate URL pattern
    → check duplicate
    → state.post_url = url
    → state.step = "awaiting_confirm"
    → send confirmation + [Confirm] [Cancel]

seed_confirm:
  → Post.create(...)
  → clear state
  → "✅ Post saved."

seed_cancel:
  → clear state
  → "❌ Cancelled."
```

## Implementation Steps

### 1. Add types and state map (after `pendingEditState` declaration)

```typescript
type ESeedStep = "awaiting_content_type" | "awaiting_raw_content" | "awaiting_post_url" | "awaiting_confirm";

interface ISeedState {
  step: ESeedStep;
  content_type?: string;
  raw_content?: string;
  post_url?: string;
  timeoutId?: ReturnType<typeof setTimeout>;
}

const pendingSeedState = new Map<string, ISeedState>();

function clearSeedState(chatId: string): void {
  const state = pendingSeedState.get(chatId);
  if (state?.timeoutId) clearTimeout(state.timeoutId);
  pendingSeedState.delete(chatId);
}

function setSeedState(chatId: string, state: Omit<ISeedState, "timeoutId">): void {
  clearSeedState(chatId);
  const timeoutId = setTimeout(() => pendingSeedState.delete(chatId), 10 * 60 * 1000);
  pendingSeedState.set(chatId, { ...state, timeoutId });
}
```

### 2. Add `Post` and `EPostStatus` imports

`Post` is already imported via `../db/index.js`. Add `EPostStatus`:
```typescript
import { ..., EPostStatus } from "../db/index.js";
```

### 3. Add content_type keyboard builder

```typescript
function buildContentTypeKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Hot Take", callback_data: "seed_type:hot_take" },
        { text: "Curation", callback_data: "seed_type:curation" },
      ],
      [
        { text: "Announcement", callback_data: "seed_type:announcement" },
        { text: "Engagement", callback_data: "seed_type:engagement" },
      ],
      [
        { text: "Thread", callback_data: "seed_type:thread" },
      ],
    ],
  };
}
```

### 4. Add `handleSeedCommand()`

```typescript
async function handleSeedCommand(chatId: string): Promise<void> {
  setSeedState(chatId, { step: "awaiting_content_type" });

  await callTelegram("sendMessage", {
    chat_id: chatId,
    text: "🌱 *Seed a Post*\n\nSelect the content type:",
    parse_mode: "MarkdownV2",
    reply_markup: buildContentTypeKeyboard(),
  });
}
```

### 5. Add seed callback handlers in `handleCallbackQuery()`

Add after the `self_reject` branch:

```typescript
} else if (data.startsWith("seed_type:")) {
  const contentType = data.split(":")[1];
  await handleSeedTypeCallback(chatId, contentType);
} else if (data === "seed_confirm") {
  await handleSeedConfirm(chatId, messageId);
} else if (data === "seed_cancel") {
  clearSeedState(chatId);
  if (messageId) {
    await callTelegram("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: "❌ Cancelled\\.",
      parse_mode: "MarkdownV2",
    });
  }
}
```

Add handler functions:

```typescript
async function handleSeedTypeCallback(chatId: string, contentType: string): Promise<void> {
  const state = pendingSeedState.get(chatId);
  if (!state) return;

  setSeedState(chatId, { ...state, content_type: contentType, step: "awaiting_raw_content" });

  await callTelegram("sendMessage", {
    chat_id: chatId,
    text: `📝 *Content type:* ${escapeMarkdown(contentType)}\n\nEnter the post content:`,
    parse_mode: "MarkdownV2",
  });
}

async function handleSeedConfirm(chatId: string, messageId: number | undefined): Promise<void> {
  const state = pendingSeedState.get(chatId);
  if (!state || !state.content_type || !state.raw_content || !state.post_url) {
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text: "❌ *Error*\n\nIncomplete seed data\\. Start over with /seed\\.",
      parse_mode: "MarkdownV2",
    });
    return;
  }

  try {
    await Post.create({
      content_type: state.content_type,
      raw_content: state.raw_content,
      post_url: state.post_url,
      status: EPostStatus.POSTED,
      platform: "twitter",
      media: [],
      ai_stack: [],
      is_viral_candidate: false,
      external_refs: [],
      edit_history: [],
    });

    clearSeedState(chatId);

    const text = "✅ *Post saved\\.*\n\nThe post is now in the DB and will be used for self\\-reply matching\\.";
    if (messageId) {
      await callTelegram("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: "MarkdownV2",
      });
    } else {
      await callTelegram("sendMessage", { chat_id: chatId, text, parse_mode: "MarkdownV2" });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`[KolTelegramBot] Seed Post.create failed: ${msg}`);
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text: `❌ *Failed to save post*\n\n${escapeMarkdown(msg)}`,
      parse_mode: "MarkdownV2",
    });
  }
}
```

### 6. Update `handleTextMessage()` — add seed flow

Add seed state handling before the `pendingEditState` check:

```typescript
// Seed flow
const seedState = pendingSeedState.get(chatId);
if (seedState) {
  await handleSeedTextInput(chatId, text, seedState);
  return;
}
```

Add `handleSeedTextInput()` function:

```typescript
async function handleSeedTextInput(chatId: string, text: string, state: ISeedState): Promise<void> {
  if (state.step === "awaiting_raw_content") {
    if (!text.trim()) {
      await callTelegram("sendMessage", {
        chat_id: chatId,
        text: "⚠️ Content cannot be empty\\. Enter the post content:",
        parse_mode: "MarkdownV2",
      });
      return;
    }
    setSeedState(chatId, { ...state, raw_content: text.trim(), step: "awaiting_post_url" });
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text: "🔗 Enter the post URL \\(e\\.g\\. https://x\\.com/yourhandle/status/123\\):",
      parse_mode: "MarkdownV2",
    });
    return;
  }

  if (state.step === "awaiting_post_url") {
    const urlPattern = /x\.com\/.+\/status\/\d+/;
    if (!urlPattern.test(text)) {
      await callTelegram("sendMessage", {
        chat_id: chatId,
        text: "⚠️ Invalid URL\\. Must match `x\\.com/handle/status/ID`\\. Try again:",
        parse_mode: "MarkdownV2",
      });
      return;
    }

    const existing = await Post.findOne({ post_url: text.trim() });
    if (existing) {
      await callTelegram("sendMessage", {
        chat_id: chatId,
        text: "⚠️ This post URL already exists in the DB\\. Use a different URL or /cancel\\.",
        parse_mode: "MarkdownV2",
      });
      return;
    }

    setSeedState(chatId, { ...state, post_url: text.trim(), step: "awaiting_confirm" });

    const confirmText =
      `✅ *Confirm Post Seed*\n\n` +
      `*Type:* ${escapeMarkdown(state.content_type ?? "")}\n` +
      `*Content:* ${escapeMarkdown((state.raw_content ?? "").substring(0, 100))}${(state.raw_content ?? "").length > 100 ? "\\.\\.\\." : ""}\n` +
      `*URL:* ${escapeMarkdown(text.trim())}`;

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
```

### 7. Update `handleCommand()` — add `/seed`

Add to the switch statement:
```typescript
case "/seed":
  await handleSeedCommand(chatId);
  break;
```

### 8. Update `/cancel` handling in `handleTextMessage()`

In the `/cancel` branch, also clear seed state:
```typescript
if (text === "/cancel") {
  if (pendingEditState.has(chatId)) {
    pendingEditState.delete(chatId);
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text: "❌ Edit cancelled\\.",
      parse_mode: "MarkdownV2",
    });
  } else if (pendingSeedState.has(chatId)) {
    clearSeedState(chatId);
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text: "❌ Seed cancelled\\.",
      parse_mode: "MarkdownV2",
    });
  }
  return;
}
```

## Todo

- [ ] Add `ISeedState` type and `pendingSeedState` map
- [ ] Add `clearSeedState()` and `setSeedState()` helpers
- [ ] Add `EPostStatus` to db/index imports
- [ ] Add `buildContentTypeKeyboard()` function
- [ ] Add `handleSeedCommand()` function
- [ ] Add `handleSeedTypeCallback()` and `handleSeedConfirm()` functions
- [ ] Add `handleSeedTextInput()` function
- [ ] Add `seed_type/confirm/cancel` branches in `handleCallbackQuery()`
- [ ] Add seed flow check in `handleTextMessage()` (before edit state check)
- [ ] Add `/seed` to `handleCommand()` switch
- [ ] Update `/cancel` to also clear seed state
- [ ] Run `npm run typecheck` — confirm no errors

## Success Criteria

- `tsc` passes
- `/seed` sends a keyboard with 5 content_type options
- Full happy path: type → content → URL → confirm → `Post` document created in DB
- Invalid URL format prompts retry without clearing state
- Duplicate URL shows error without clearing state
- `/cancel` clears seed state and sends confirmation
- 10-minute timeout clears state automatically (no memory leak)
- Existing KOL edit flow and self-reply edit flow are unaffected

## Risk Assessment

- Low risk — entirely additive; no existing code paths modified except `handleTextMessage()` and `handleCommand()`
- `setSeedState()` helper ensures timeout is always reset when state is updated (no stale timeouts)
- `clearSeedState()` clears the timeout before deleting to prevent memory leaks

## Security Considerations

- `raw_content` and `post_url` come from the Telegram admin user — trusted input
- `post_url` is validated against a regex before use
- `Post.create()` uses Mongoose validation — schema enforces required fields
