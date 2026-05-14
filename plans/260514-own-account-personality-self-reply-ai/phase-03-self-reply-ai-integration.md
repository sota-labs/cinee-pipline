# Phase 03 — Self-Reply AI Integration

**Priority:** High
**Status:** Pending
**Blocked by:** Phase 01, Phase 02

---

## Context Links

- Researcher report: `plans/reports/researcher-own-account-personality.md` (sections 2, 3, 4, 5, 7)
- File to modify: `src/services/selfReplyService.ts`
- File to modify: `src/routes/tasks.ts`
- Pattern reference: `src/services/replyEngineService.ts` (Task creation, `processGeneratedSuggestions`, `processAFKMode`)
- Prompt: `src/prompts/kolPrompts.ts` → `buildSelfReplyPrompt()` (already exists)
- Mode source: `src/db/models/KolSettings.ts` → `KolSettings.getSettings()` → `settings.default_mode`
- Telegram: `src/telegram/kolTelegramBotNative.ts` → `sendSuggestionForReview()` (for manual mode)

---

## Overview

Two files to modify:

1. **`src/services/selfReplyService.ts`** — replace the `generateReplyContent()` stub with `queueSelfReplyGeneration()` that creates an OpenClaw Task, and add `processSelfReplyResult()` to handle the webhook callback.

2. **`src/routes/tasks.ts`** — add two new `setImmediate` dispatch cases in the `PATCH /:id/complete` handler:
   - `payload.analysisType === "own_account_personality"` → `ownAccountService.applyLearnedProfile()`
   - `payload.analysisType === "self_reply_generation"` → `selfReplyService.processSelfReplyResult()`

---

## Requirements

- `SelfReplyQueue` has no `mode` field — use `KolSettings.getSettings()` → `settings.default_mode` for AFK/Manual decision
- AFK mode: auto-send the reply with highest confidence (no threshold check needed — self-replies are always high quality)
- Manual mode: send Telegram notification via `sendSuggestionForReview()` — but `sendSuggestionForReview` takes `IKolReplySuggestion`. Need to adapt or create a self-reply specific Telegram notification.
- Task payload must include `ref_id` pointing to `SelfReplyQueue._id` and `comment_id` for the specific comment
- `processAllQueues()` must call `queueSelfReplyGeneration()` instead of `generateReplyContent()` + `sendReply()`
- After queuing, mark comment status as `ECommentStatus.QUEUED` (not SENT — actual send happens after AI returns)

---

## Changes to `src/services/selfReplyService.ts`

### New imports to add:

```typescript
import { OwnAccountProfile } from "../db/models/OwnAccountProfile.js";
import { Post } from "../db/models/Post.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";
import { KolSettings } from "../db/models/KolSettings.js";
import { buildSelfReplyPrompt } from "../prompts/kolPrompts.js";
import { settings } from "../config/settings.js";
```

### Replace `generateReplyContent()` with `queueSelfReplyGeneration()`

Remove the private `generateReplyContent()` stub entirely. Add:

```typescript
/**
 * Queue AI reply generation for a comment via OpenClaw.
 * Marks comment as QUEUED. Actual send happens in processSelfReplyResult().
 */
async queueSelfReplyGeneration(
  queueId: string,
  comment: IPendingComment,
): Promise<string | null> {
  // Fetch own account personality
  const profile = await OwnAccountProfile.findOne({ _key: "own_account" });
  const writingStyle = profile?.effective_profile?.writing_style ?? "conversational and direct";

  // Fetch original post content for context
  const queue = await SelfReplyQueue.findById(queueId);
  if (!queue) return null;

  const post = await Post.findById(queue.our_post_id);
  const originalPostContent = post?.raw_content ?? "";

  const prompt = buildSelfReplyPrompt({
    originalPostContent,
    commentAuthor: comment.author_handle,
    commentContent: comment.content,
    commentLikes: comment.likes,
    authorTrustScore: comment.author_trust_score,
    interactionCount: 0, // TODO: wire to Interaction model if needed
    yourStyle: writingStyle,
  });

  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  const command = `agent --agent ${settings.openClawAgent} --message '${escapedPrompt}'`;

  const task = await Task.create({
    type: ETaskType.CRON_JOB_TRIGGER,
    agent: settings.openClawAgent,
    prompt: command,
    status: ETaskStatus.PENDING,
    payload: {
      analysisType: "self_reply_generation",
      ref_id: String(queueId),
      comment_id: comment.comment_id,
    },
  });

  // Mark comment as queued
  const updatedQueue = await SelfReplyQueue.findById(queueId);
  if (updatedQueue) {
    const c = updatedQueue.pending_comments.find((pc) => pc.comment_id === comment.comment_id);
    if (c) {
      c.status = ECommentStatus.QUEUED;
      await updatedQueue.save();
    }
  }

  log.info(`[SelfReply] Queued AI generation task ${task._id} for comment ${comment.comment_id}`);
  return String(task._id);
}
```

### Add `processSelfReplyResult()` method

This is called by the webhook after OpenClaw returns the AI-generated reply text.

The `SELF_REPLY_GENERATION_PROMPT` returns **plain text** (not JSON) — see `kolPrompts.ts` line 171: "Respond with just the reply text (no JSON, no quotes, max 50 words)".

```typescript
/**
 * Handle AI result for self-reply generation.
 * Called by webhook after OpenClaw completes the task.
 */
async processSelfReplyResult(
  queueId: string,
  commentId: string,
  rawResult: string,
): Promise<void> {
  const replyContent = rawResult.trim();

  if (!replyContent) {
    log.error(`[SelfReply] Empty AI result for comment ${commentId}`);
    return;
  }

  const settings = await KolSettings.getSettings();
  const mode = settings.default_mode; // "afk" | "manual"

  if (mode === "afk") {
    // Auto-send via OpenClaw
    const queue = await SelfReplyQueue.findById(queueId);
    if (!queue) return;

    const result = await this.sendReply(queueId, commentId, replyContent);
    if (result.success) {
      log.info(`[SelfReply] AFK auto-sent reply to comment ${commentId}`);
    } else {
      log.error(`[SelfReply] AFK send failed for comment ${commentId}: ${result.error}`);
    }
  } else {
    // Manual mode — notify via Telegram
    await this.notifyManualReview(queueId, commentId, replyContent);
  }
}
```

### Add `notifyManualReview()` private method

`sendSuggestionForReview()` in `kolTelegramBotNative.ts` takes `IKolReplySuggestion` — it's tightly coupled to KOL reply flow. For self-replies, send a simpler Telegram message directly.

```typescript
private async notifyManualReview(
  queueId: string,
  commentId: string,
  replyContent: string,
): Promise<void> {
  // Import sendTelegramMessage or use the native https approach
  // For now, log and store the reply content for manual review
  // Full Telegram integration: call callTelegram("sendMessage", {...}) from kolTelegramBotNative.ts
  // or extract a shared sendMessage utility
  log.info(`[SelfReply] Manual review needed for comment ${commentId}: "${replyContent}"`);

  // Store reply content on the comment for manual review via API
  const queue = await SelfReplyQueue.findById(queueId);
  if (!queue) return;

  const comment = queue.pending_comments.find((c) => c.comment_id === commentId);
  if (comment) {
    comment.reply_content = replyContent;
    // Keep status as QUEUED — admin approves via API
    await queue.save();
  }
}
```

**Implementation note:** Full Telegram notification for manual mode requires extracting a shared `callTelegram()` utility from `kolTelegramBotNative.ts` or importing it directly. Defer to a follow-up task if `kolTelegramBotNative.ts` doesn't export `callTelegram`. The stored `reply_content` on the comment is sufficient for Phase 04 API to expose for manual review.

### Update `processAllQueues()`

Replace the `generateReplyContent()` + `sendReply()` call:

```typescript
// BEFORE (remove):
const replyContent = await this.generateReplyContent(candidate);
processed++;
const result = await this.sendReply(queueInfo.queueId, candidate.comment_id, replyContent);

// AFTER:
processed++;
const taskId = await this.queueSelfReplyGeneration(queueInfo.queueId, candidate);
if (taskId) {
  succeeded++;
} else {
  failed++;
}
```

**Important:** `processAllQueues` no longer calls `sendReply` directly — the actual send is deferred to `processSelfReplyResult` after OpenClaw returns. The `succeeded` count now means "successfully queued for AI generation".

---

## Changes to `src/routes/tasks.ts`

### New imports to add at top:

```typescript
import { ownAccountService } from "../services/ownAccountService.js";
import { selfReplyService } from "../services/selfReplyService.js";
```

### Add two new dispatch cases in `PATCH /:id/complete` `setImmediate` block

The existing block handles `payload.analysisType` with `relatedId`. The new cases use different payload shapes, so add them as separate `if` blocks after the existing ones:

```typescript
// After the existing payload.analysisType block (around line 165):

// Handle own-account personality learning result
if (payload.analysisType === "own_account_personality") {
  setImmediate(async () => {
    try {
      await ownAccountService.applyLearnedProfile(rawResult);
      log.info("[Webhook] Applied own_account_personality learning result");
    } catch (e: unknown) {
      log.error(`[Webhook] Error applying own_account_personality: ${(e as Error).message}`);
    }
  });
}

// Handle self-reply AI generation result
if (payload.analysisType === "self_reply_generation") {
  const refId = String(payload.ref_id ?? "");
  const commentId = String(payload.comment_id ?? "");
  if (refId && commentId) {
    setImmediate(async () => {
      try {
        await selfReplyService.processSelfReplyResult(refId, commentId, rawResult);
        log.info(`[Webhook] Processed self_reply_generation for comment ${commentId}`);
      } catch (e: unknown) {
        log.error(`[Webhook] Error processing self_reply_generation: ${(e as Error).message}`);
      }
    });
  }
}
```

**Placement:** These go inside the `if (task.payload && typeof task.payload === "object")` block, after the existing `payload.action === "generate_suggestions"` block (around line 181).

**Note on existing `payload.analysisType` block:** The existing block checks `payload.analysisType && payload.relatedId`. The new `"own_account_personality"` case has no `relatedId`, so it won't be caught by the existing block. Add it as a separate `if` check.

---

## Todo List

- [ ] Add new imports to `selfReplyService.ts` (OwnAccountProfile, Post, Task, KolSettings, buildSelfReplyPrompt, settings)
- [ ] Add `queueSelfReplyGeneration(queueId, comment)` method to `SelfReplyService`
- [ ] Add `processSelfReplyResult(queueId, commentId, rawResult)` method to `SelfReplyService`
- [ ] Add `notifyManualReview(queueId, commentId, replyContent)` private method
- [ ] Update `processAllQueues()` to call `queueSelfReplyGeneration` instead of `generateReplyContent` + `sendReply`
- [ ] Remove private `generateReplyContent()` stub
- [ ] Add `ownAccountService` and `selfReplyService` imports to `tasks.ts`
- [ ] Add `own_account_personality` dispatch case in `tasks.ts` webhook
- [ ] Add `self_reply_generation` dispatch case in `tasks.ts` webhook
- [ ] Verify `selfReplyService.ts` stays under 200 lines — split if needed
- [ ] Run `tsc --noEmit` to verify compilation

---

## Success Criteria

- `processAllQueues()` creates Task records instead of calling `sendReply()` directly
- Webhook correctly routes `own_account_personality` → `ownAccountService.applyLearnedProfile()`
- Webhook correctly routes `self_reply_generation` → `selfReplyService.processSelfReplyResult()`
- AFK mode: `processSelfReplyResult` calls `sendReply()` automatically
- Manual mode: `processSelfReplyResult` stores `reply_content` on comment for API review

---

## Risk Assessment

- **Medium:** `selfReplyService.ts` may exceed 200 lines after additions — split `processSelfReplyResult` + `notifyManualReview` into `selfReplyResultHandler.ts` if needed
- **Medium:** `sendReply()` currently marks comment as SENT immediately (stub behavior) — verify it still works correctly when called from `processSelfReplyResult` after AI generation
- **Low:** `SELF_REPLY_GENERATION_PROMPT` returns plain text, not JSON — no JSON parsing needed in `processSelfReplyResult`

---

## Security Considerations

- Prompt escaping: `prompt.replace(/'/g, "'\\''")` — same pattern as existing services
- `rawResult` from webhook is untrusted — trim and validate non-empty before use

---

## Next Steps

Phase 04 mounts the `/api/account` routes and adds the guard in `replyEngineService.ts`.
