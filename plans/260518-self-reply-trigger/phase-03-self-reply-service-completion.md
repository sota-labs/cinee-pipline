# Phase 3: selfReplyService Completion + tasks.ts Webhook

**Status:** Pending
**Priority:** High — execution layer; Phase 4 depends on this
**Depends on:** Phase 1 (schema), Phase 2 (queue creation)

## Context Links

- Spec: `plans/reports/spec-260518-self-reply-trigger.md` §4, §5 (AFK branch)
- selfReplyService: `src/services/selfReplyService.ts`
- tasks.ts: `src/routes/tasks.ts`
- kolPrompts.ts: `src/prompts/kolPrompts.ts` (add execute-reply prompt builder)
- Task model: `src/db/models/Task.ts`

## Overview

Three changes:
1. Add `addCommentToQueue()` method to `SelfReplyService` (called by Phase 2 route)
2. Replace the `sendReply()` stub with a real `Task.create()` call that queues execution via OpenClaw
3. Add `execute_self_reply` webhook handlers in `tasks.ts` complete/fail routes, plus `processExecutionComplete()` and `processExecutionFailed()` methods in the service

Also adds `buildExecuteReplyPrompt()` to `kolPrompts.ts` — the prompt that tells OpenClaw to post the reply on X.

## File Ownership

- `src/services/selfReplyService.ts`
- `src/routes/tasks.ts`
- `src/prompts/kolPrompts.ts`

## Requirements

### Functional

**`addCommentToQueue(queueId, comment)`**
- Find queue by ID; return false if not found
- Check for duplicate `comment_id` in `pending_comments`; return false if duplicate
- Append new comment with `status: PENDING`, `priority_score: 0`, `engagement_points: 0`, `author_trust_score: 50`
- Increment `total_comments`
- Call `rankComments(queueId)` to recalculate priorities
- Return true on success

**`sendReply(queueId, commentId, replyContent)` — replace stub**
- Find queue and comment (existing guard logic stays)
- Set `comment.status = ECommentStatus.QUEUED` and `comment.reply_content = replyContent`
- Save queue
- Create Task with:
  - `type: ETaskType.SINGLE_TASK_TRIGGER`
  - `agent: settings.openClawAgent`
  - `prompt: buildExecuteReplyPrompt(queue.post_url, commentId, replyContent)`
  - `status: ETaskStatus.PENDING`
  - `payload: { action: "execute_self_reply", queueId, commentId }`
- Return `{ success: true, replyId: String(task._id) }`
- On error: reset `comment.status = ECommentStatus.PENDING`, save, return `{ success: false, error }`

**`processExecutionComplete(queueId, commentId)`**
- Find queue and comment
- Set `comment.status = ECommentStatus.SENT`, `comment.replied_at = new Date()`
- Set `queue.last_reply_sent_at = new Date()`, increment `queue.processed_count`
- If `processed_count >= total_comments` → set `queue.queue_status = EQueueStatus.COMPLETED`
- Save queue

**`processExecutionFailed(queueId, commentId, errorLog)`**
- Find queue and comment
- Set `comment.status = ECommentStatus.FAILED`
- Save queue
- Log error

**`buildExecuteReplyPrompt(postUrl, commentId, replyContent)` in `kolPrompts.ts`**
- Returns a prompt string instructing OpenClaw to navigate to `postUrl`, find the comment with ID `commentId`, and post `replyContent` as a reply

**`tasks.ts` — complete webhook**
- Add handler for `payload.action === "execute_self_reply"`:
  ```typescript
  if (payload.action === "execute_self_reply" && payload.queueId && payload.commentId) {
    const queueId = String(payload.queueId);
    const commentId = String(payload.commentId);
    setImmediate(async () => {
      try {
        await selfReplyService.processExecutionComplete(queueId, commentId);
        log.info(`[Webhook] execute_self_reply complete for comment ${commentId}`);
      } catch (e: unknown) {
        log.error(`[Webhook] Error in execute_self_reply complete: ${(e as Error).message}`);
      }
    });
  }
  ```

**`tasks.ts` — fail webhook**
- Add handler for `payload.action === "execute_self_reply"`:
  ```typescript
  if (payload.action === "execute_self_reply" && payload.queueId && payload.commentId) {
    const queueId = String(payload.queueId);
    const commentId = String(payload.commentId);
    setImmediate(async () => {
      try {
        await selfReplyService.processExecutionFailed(queueId, commentId, task.error_log ?? "");
        log.info(`[Webhook] execute_self_reply failed for comment ${commentId}`);
      } catch (e: unknown) {
        log.error(`[Webhook] Error in execute_self_reply fail: ${(e as Error).message}`);
      }
    });
  }
  ```

## Architecture

```
sendReply(queueId, commentId, replyContent)
  → comment.status = QUEUED
  → Task.create({ action: "execute_self_reply", queueId, commentId })
  → return { success: true, replyId: taskId }

PATCH /api/tasks/:id/complete (execute_self_reply)
  → selfReplyService.processExecutionComplete(queueId, commentId)
    → comment.status = SENT, replied_at = now
    → queue.last_reply_sent_at = now, processed_count++
    → if done → queue_status = COMPLETED

PATCH /api/tasks/:id/fail (execute_self_reply)
  → selfReplyService.processExecutionFailed(queueId, commentId, errorLog)
    → comment.status = FAILED
```

## Implementation Steps

### 1. `src/prompts/kolPrompts.ts` — add execute-reply prompt

Add after `buildPostQualityCheckPrompt`:

```typescript
export const EXECUTE_SELF_REPLY_PROMPT = `You are an AI Agent with browser access. Post a reply to a comment on X.

BROWSER RULE: Keep ONLY ONE tab open at all times.

Step 1: Open {{post_url}} in the browser.
Step 2: Wait for the page to load. Find the comment with tweet ID {{comment_id}} in the replies section.
Step 3: Click the Reply button on that comment.
Step 4: Type the following reply text exactly as provided:
{{reply_content}}
Step 5: Click the Post/Reply button to submit.
Step 6: Confirm the reply was posted successfully.
${OUTPUT_FORMAT_INSTRUCTION}`;

export function buildExecuteReplyPrompt(
  postUrl: string,
  commentId: string,
  replyContent: string,
): string {
  return EXECUTE_SELF_REPLY_PROMPT
    .replace("{{post_url}}", postUrl)
    .replace("{{comment_id}}", commentId)
    .replace("{{reply_content}}", replyContent);
}
```

### 2. `src/services/selfReplyService.ts` — add `addCommentToQueue()`

Add after `createReplyQueue()`:

```typescript
async addCommentToQueue(
  queueId: string,
  comment: { comment_id: string; author_handle: string; content: string; likes: number },
): Promise<boolean> {
  const queue = await SelfReplyQueue.findById(queueId);
  if (!queue) {
    log.warn(`[SelfReply] addCommentToQueue: queue ${queueId} not found`);
    return false;
  }

  const duplicate = queue.pending_comments.some((c) => c.comment_id === comment.comment_id);
  if (duplicate) {
    log.info(`[SelfReply] Duplicate comment_id ${comment.comment_id} — skipping`);
    return false;
  }

  queue.pending_comments.push({
    comment_id: comment.comment_id,
    author_handle: comment.author_handle,
    content: comment.content,
    likes: comment.likes,
    engagement_points: 0,
    author_trust_score: 50,
    is_hidden: false,
    is_spam: false,
    status: ECommentStatus.PENDING,
    priority_score: 0,
  });
  queue.total_comments++;
  await queue.save();

  await this.rankComments(queueId);
  log.info(`[SelfReply] Added comment ${comment.comment_id} to queue ${queueId}`);
  return true;
}
```

### 3. `src/services/selfReplyService.ts` — replace `sendReply()` stub

Replace the current `sendReply()` body (lines 190–231) with:

```typescript
async sendReply(
  queueId: string,
  commentId: string,
  replyContent: string,
): Promise<IReplyResult> {
  const queue = await SelfReplyQueue.findById(queueId);
  if (!queue) return { success: false, error: "Queue not found" };

  const comment = queue.pending_comments.find((c) => c.comment_id === commentId);
  if (!comment) return { success: false, error: "Comment not found" };

  if (comment.status !== ECommentStatus.PENDING && comment.status !== ECommentStatus.QUEUED) {
    return { success: false, error: `Comment already processed (status: ${comment.status})` };
  }

  comment.status = ECommentStatus.QUEUED;
  comment.reply_content = replyContent;
  await queue.save();

  try {
    const prompt = buildExecuteReplyPrompt(queue.post_url, commentId, replyContent);
    const task = await Task.create({
      type: ETaskType.SINGLE_TASK_TRIGGER,
      agent: settings.openClawAgent,
      prompt,
      status: ETaskStatus.PENDING,
      payload: { action: "execute_self_reply", queueId, commentId },
    });

    log.info(`[SelfReply] Queued execute task ${task._id} for comment ${commentId}`);
    return { success: true, replyId: String(task._id) };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`[SelfReply] Failed to create execute task for comment ${commentId}: ${msg}`);
    comment.status = ECommentStatus.PENDING;
    await queue.save();
    return { success: false, error: msg };
  }
}
```

Add import at top of `selfReplyService.ts`:
```typescript
import { buildExecuteReplyPrompt } from "../prompts/kolPrompts.js";
```

### 4. `src/services/selfReplyService.ts` — add `processExecutionComplete()` and `processExecutionFailed()`

Add after `sendReply()`:

```typescript
async processExecutionComplete(queueId: string, commentId: string): Promise<void> {
  const queue = await SelfReplyQueue.findById(queueId);
  if (!queue) return;

  const comment = queue.pending_comments.find((c) => c.comment_id === commentId);
  if (!comment) return;

  comment.status = ECommentStatus.SENT;
  comment.replied_at = new Date();
  queue.last_reply_sent_at = new Date();
  queue.processed_count++;

  if (queue.processed_count >= queue.total_comments) {
    queue.queue_status = EQueueStatus.COMPLETED;
  }

  await queue.save();
  log.info(`[SelfReply] Comment ${commentId} marked SENT in queue ${queueId}`);
}

async processExecutionFailed(queueId: string, commentId: string, errorLog: string): Promise<void> {
  const queue = await SelfReplyQueue.findById(queueId);
  if (!queue) return;

  const comment = queue.pending_comments.find((c) => c.comment_id === commentId);
  if (!comment) return;

  comment.status = ECommentStatus.FAILED;
  await queue.save();
  log.error(`[SelfReply] Comment ${commentId} FAILED in queue ${queueId}: ${errorLog}`);
}
```

### 5. `src/routes/tasks.ts` — add `execute_self_reply` in complete webhook

In the `PATCH /:id/complete` handler, after the existing `execute_reply` block (around line 208), add:

```typescript
// Handle self-reply execution result
if (payload.action === "execute_self_reply" && payload.queueId && payload.commentId) {
  const queueId = String(payload.queueId);
  const commentId = String(payload.commentId);
  setImmediate(async () => {
    try {
      await selfReplyService.processExecutionComplete(queueId, commentId);
      log.info(`[Webhook] execute_self_reply complete for comment ${commentId}`);
    } catch (e: unknown) {
      log.error(`[Webhook] Error in execute_self_reply complete: ${(e as Error).message}`);
    }
  });
}
```

### 6. `src/routes/tasks.ts` — add `execute_self_reply` in fail webhook

In the `PATCH /:id/fail` handler, after the existing `execute_reply` block (around line 270), add:

```typescript
// Handle self-reply execution failure
if (payload.action === "execute_self_reply" && payload.queueId && payload.commentId) {
  const queueId = String(payload.queueId);
  const commentId = String(payload.commentId);
  setImmediate(async () => {
    try {
      await selfReplyService.processExecutionFailed(queueId, commentId, task.error_log ?? "");
      log.info(`[Webhook] execute_self_reply failed for comment ${commentId}`);
    } catch (e: unknown) {
      log.error(`[Webhook] Error in execute_self_reply fail: ${(e as Error).message}`);
    }
  });
}
```

## Todo

- [ ] Add `EXECUTE_SELF_REPLY_PROMPT` constant and `buildExecuteReplyPrompt()` to `kolPrompts.ts`
- [ ] Add `buildExecuteReplyPrompt` import to `selfReplyService.ts`
- [ ] Add `addCommentToQueue()` method to `SelfReplyService`
- [ ] Replace `sendReply()` stub with real Task.create() implementation
- [ ] Add `processExecutionComplete()` method
- [ ] Add `processExecutionFailed()` method
- [ ] Add `execute_self_reply` handler in `tasks.ts` complete webhook
- [ ] Add `execute_self_reply` handler in `tasks.ts` fail webhook
- [ ] Run `npm run typecheck` — confirm no errors

## Success Criteria

- `tsc` passes
- `addCommentToQueue()` returns false for duplicate `comment_id`, true for new comment
- `sendReply()` creates a `Task` document with `action: "execute_self_reply"` in payload
- `sendReply()` sets comment status to `QUEUED` (not `SENT`) before returning
- Complete webhook marks comment `SENT` and updates `last_reply_sent_at`
- Fail webhook marks comment `FAILED`

## Risk Assessment

- Medium — `sendReply()` is called from `processSelfReplyResult()` (AFK path) and will be called from Telegram handler (Phase 4 manual path). Both paths converge here correctly.
- The status guard in `sendReply()` now accepts both `PENDING` and `QUEUED` to handle the manual-mode case where `storeForManualReview()` leaves the comment as `QUEUED`.

## Security Considerations

- `replyContent` is passed directly into the prompt. No injection risk since OpenClaw executes it as a browser instruction, not a shell command. The content is user-generated AI output, not external input.
