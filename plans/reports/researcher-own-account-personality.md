# Researcher Report: Own Account Personality Learning Feature

**Date:** 2026-05-14
**Branch:** chore/improve-kol-crawl
**Scope:** Research for implementing own-account personality learning (mirroring KOL personality learning for the CEO's own X account)

---

## 1. Task Type Strings

### Personality Learning Task Type
- **analysisType value in payload:** `"personality"` (string literal)
- **Task.type field:** `ETaskType.CRON_JOB_TRIGGER` = `"cron_job_trigger"`
- The `analysisType` is stored in `task.payload.analysisType`, NOT in `task.type`
- The webhook in `tasks.ts` dispatches on `payload.analysisType`, not `task.type`

```ts
// kolAnalyzerService.ts — queueAnalysisTask()
await Task.create({
  type: ETaskType.CRON_JOB_TRIGGER,   // always "cron_job_trigger"
  payload: { analysisType: "personality", relatedId: kolId },
});
```

### Reply Generation Task Type
- **action value in payload:** `"generate_suggestions"`
- **Task.type field:** `ETaskType.CRON_JOB_TRIGGER` = `"cron_job_trigger"`
- Dispatched in webhook via `payload.action === "generate_suggestions"`

```ts
// replyEngineService.ts — generateSuggestions()
await Task.create({
  type: ETaskType.CRON_JOB_TRIGGER,
  payload: { action: "generate_suggestions", postId, suggestionId, mode },
});
```

---

## 2. processGeneratedSuggestions() — AI Output JSON Structure

**File:** `src/services/replyEngineService.ts` lines 184–242

Expected JSON from AI:
```json
{
  "suggestions": [
    {
      "content": "Reply text here",
      "tone": "casual",
      "confidence": 85,
      "reasoning": "Matches their meme style while adding value",
      "expected_engagement": 8
    }
  ]
}
```

Parsing logic:
- `JSON.parse(rawResult)` — direct parse, no extraction wrapper
- Validates `parsed.suggestions` is an array
- Maps each item to `ISuggestion` with `id: "sugg_${index+1}"`
- Clamps `confidence` to 0–100
- On parse failure: sets `execution_status = FAILED`, stores error in `error_message`

After parsing, routes by mode:
- `EReplyMode.AFK` → calls `this.processAFKMode(suggestion)`
- `EReplyMode.MANUAL` → calls `sendSuggestionForReview(suggestion)` from Telegram bot

---

## 3. processAFKMode() — Scheduling Fields

**File:** `src/services/replyEngineService.ts` lines 247–287

Fields set on the `KolReplySuggestion` document:
```ts
suggestion.selected_suggestion_id = bestSuggestion.id;  // e.g. "sugg_1"
suggestion.auto_reply_scheduled_at = new Date(Date.now() + delayMinutes * 60 * 1000);
```

Scheduling logic:
- Filters suggestions by `confidence >= settings.afk.min_confidence_threshold`
- Picks highest confidence suggestion
- Random delay: `Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin` minutes
- `delayMin` / `delayMax` come from `KolSettings.afk.auto_delay_min_minutes` / `auto_delay_max_minutes`
- Falls back to manual mode if no suggestion meets threshold OR post `virality_score < 30`

The scheduled reply is later executed by `runScheduledAFKReplies()` (cron: every 10 min via `kolAFKReplyCron.ts`), which queries:
```ts
KolReplySuggestion.find({
  mode: EReplyMode.AFK,
  execution_status: EReplyExecutionStatus.PENDING,
  auto_reply_scheduled_at: { $lte: new Date() },
})
```

---

## 4. Telegram Notification for Manual Mode

**File:** `src/telegram/kolTelegramBotNative.ts`
**Function:** `sendSuggestionForReview(suggestion: IKolReplySuggestion)`

- Uses native `https` module (no Telegram SDK dependency)
- Calls `callTelegram("sendMessage", { chat_id, text, parse_mode: "MarkdownV2", reply_markup })`
- Sends to `process.env.TELEGRAM_ADMIN_CHAT_ID`
- Attaches inline keyboard via `buildSuggestionKeyboard()` with buttons:
  - `✅ Approve 1/2/3` → callback `kol_approve:{suggestionId}:{index}`
  - `✏️ Edit` → callback `kol_edit:{suggestionId}:0`
  - `❌ Reject` → callback `kol_reject:{suggestionId}`
  - `🔗 View Post` → callback `kol_view:{suggestionId}`
- Stores returned `message_id` in `suggestion.telegram_message_id`

---

## 5. Webhook Flow: Task Completes → Route → Service Method

```
Worker finishes task
  → PATCH /api/tasks/:id/complete  (tasks.ts)
    → task.status = COMPLETED, task.result = rawResult (via extractResponse())
    → setImmediate() fires async hook:

    if payload.analysisType && payload.relatedId:
      "post_analysis"  → processPostAnalysisResult(relatedId, rawResult)
                          → kolAnalyzerService.applyAnalysisResults(relatedId, result)
                          → replyEngineService.generateSuggestions(relatedId)  [auto-trigger]
      "comment_pattern" → processCommentPatternResult(relatedId, rawResult)
                          → kolAnalyzerService.applyAnalysisResults(relatedId, {}, result)
      "personality"     → processPersonalityResult(relatedId, rawResult)
                          → kolAnalyzerService.applyPersonalityUpdate(relatedId, result)  [if method exists]

    if payload.action === "generate_suggestions" && payload.suggestionId:
      → replyEngineService.processGeneratedSuggestions(suggestionId, rawResult)
        → parses AI JSON
        → AFK mode: processAFKMode() → schedules auto_reply_scheduled_at
        → Manual mode: sendSuggestionForReview() → Telegram notification
```

Key note: The `applyPersonalityUpdate` call in the webhook is guarded by `(kolAnalyzerService as any).applyPersonalityUpdate` — it exists on the class but the webhook uses a runtime check, suggesting it was added after the webhook was written.

---

## 6. KOL Personality Learning — Minimum Posts & Query

**File:** `src/services/kolAnalyzerService.ts` — `learnPersonality()` lines 327–358

**Minimum posts required:** `5`

```ts
if (posts.length < 5) {
  log.info(`[KolAnalyzer] Not enough posts to learn personality for @${kol.handle}`);
  return false;
}
```

**Query used:**
```ts
KolPost.find({
  kol_id: kolId,
  posted_at: { $gte: thirtyDaysAgo },   // last 30 days
  status: { $in: [EKolPostStatus.ANALYZED, EKolPostStatus.REPLIED] },
}).sort({ posted_at: -1 })
```

Only posts with status `analyzed` or `replied` are included — raw/new posts are excluded.

The prompt builder (`buildPersonalityLearningPrompt`) slices to first 20 posts and truncates each post content to 200 chars.

---

## 7. SelfReplyQueue Schema

**File:** `src/db/models/SelfReplyQueue.ts`

**Important finding:** `SelfReplyQueue` does NOT have a `mode` field (afk/manual). It uses a different model than `KolReplySuggestion`.

The mode concept (afk/manual) lives exclusively in `KolReplySuggestion` (for KOL reply engine). `SelfReplyQueue` is a separate, simpler model for replying to comments on the CEO's own posts.

### SelfReplyQueue top-level fields:
| Field | Type | Notes |
|---|---|---|
| `our_post_id` | ObjectId → Post | Required, indexed |
| `platform` | String | Default: `"twitter"` |
| `post_url` | String | Required |
| `pending_comments` | IPendingComment[] | Array of comment sub-docs |
| `total_comments` | Number | |
| `processed_count` | Number | |
| `queue_status` | EQueueStatus | `active / paused / completed` |
| `reply_interval_seconds` | Number | Default: 120 |
| `last_reply_sent_at` | Date | Rate limit tracking |

### IPendingComment sub-document fields:
| Field | Type | Notes |
|---|---|---|
| `comment_id` | String | Required |
| `author_handle` | String | Required |
| `content` | String | Required |
| `likes` | Number | |
| `engagement_points` | Number | Calculated from question/mention/length bonuses |
| `author_reputation` | IReputationCheck | Optional, from reputationCheckerService |
| `author_trust_score` | Number | Default 50, min threshold 30 to be eligible |
| `is_hidden` | Boolean | |
| `is_spam` | Boolean | |
| `status` | ECommentStatus | `pending / queued / sent / skipped / failed` |
| `priority_score` | Number | Weighted: likes × multiplier + trust × multiplier + engagement |
| `scheduled_reply_at` | Date | Optional |
| `replied_at` | Date | |
| `reply_content` | String | |
| `reply_id` | String | |

**No `mode` field exists on SelfReplyQueue.** The `selfReplyService.generateReplyContent()` is currently a placeholder (returns hardcoded strings). Real AI generation is noted as a TODO.

---

## 8. Own Account Personality Learning — Gap Analysis

For the new feature (learning the CEO's own writing style from their own posts), the following gaps exist vs. KOL personality learning:

### What exists (reusable):
- `PERSONALITY_LEARNING_PROMPT` in `kolPrompts.ts` — generic enough to reuse
- `buildPersonalityLearningPrompt()` — takes `handle` + `posts[]`, reusable
- `processPersonalityResult()` in `kolAnalyzerService.ts` — parses AI output, reusable
- `queueAnalysisTask()` pattern — reusable for own-account tasks
- Webhook dispatch on `payload.analysisType === "personality"` — already handles it

### What needs to be built:
1. **OwnAccountProfile model** — analogous to `KolProfile` but for the CEO's own account. Could reuse `KolProfile` schema with a special flag, or create a dedicated model. The `Post` model (CEO's own posts) is the data source — it has `raw_content`, `status`, `post_url`.
2. **Own account personality service** — query `Post` collection (not `KolPost`) for recent posted content, build prompt, queue task
3. **Minimum post threshold** — KOL uses 5 posts / 30 days. Own account should use similar logic querying `Post` where `status = "posted"`
4. **Cron script** — analogous to `kolAnalyzeCron.ts` but for own-account personality refresh
5. **Integration with selfReplyService** — `generateReplyContent()` is currently a stub; it needs to pull the learned personality profile and use `buildSelfReplyPrompt()` (already exists in `kolPrompts.ts`)

### Post model for own-account learning:
```ts
// Query own posts for personality learning
Post.find({
  status: EPostStatus.POSTED,
  platform: "twitter",
  posted_at: { $gte: thirtyDaysAgo },
}).sort({ created_at: -1 })
// Field to use: raw_content (not content — Post uses raw_content)
```

---

## 9. Key Files Reference

| File | Purpose |
|---|---|
| `src/services/kolAnalyzerService.ts` | Personality learning logic, `learnPersonality()`, `applyPersonalityUpdate()` |
| `src/services/replyEngineService.ts` | `generateSuggestions()`, `processGeneratedSuggestions()`, `processAFKMode()` |
| `src/services/selfReplyService.ts` | Self-reply queue management, `generateReplyContent()` stub |
| `src/routes/tasks.ts` | Webhook handler, `PATCH /api/tasks/:id/complete` |
| `src/prompts/kolPrompts.ts` | `PERSONALITY_LEARNING_PROMPT`, `buildPersonalityLearningPrompt()`, `buildSelfReplyPrompt()` |
| `src/db/models/KolProfile.ts` | Reference schema for personality profile sub-document |
| `src/db/models/KolReplySuggestion.ts` | `EReplyMode` (afk/manual), suggestion schema |
| `src/db/models/SelfReplyQueue.ts` | Own-post comment reply queue (no mode field) |
| `src/db/models/Post.ts` | CEO's own posts — source for own-account personality learning |
| `src/db/models/Task.ts` | `ETaskType`, `ETaskStatus` enums |
| `src/telegram/kolTelegramBotNative.ts` | `sendSuggestionForReview()` — manual mode notification |
| `src/scripts/kolAnalyzeCron.ts` | Pattern reference for cron script structure |
| `src/scripts/selfReplyCron.ts` | Cron for self-reply queue processing (every 5 min) |
| `src/scripts/kolAFKReplyCron.ts` | Cron for AFK reply execution (every 10 min) |

---

## 10. Unresolved Questions

1. Should own-account personality be stored in a new `OwnAccountProfile` model, or reuse `KolProfile` with a flag like `is_own_account: true`?
2. The `selfReplyService.generateReplyContent()` stub — should it queue an OpenClaw task (async, like KOL reply generation) or call AI inline?
3. Does the own-account personality need AFK/manual mode for self-replies, or is it always auto-send?
4. The `Post` model uses `raw_content` (not `content`) — the personality prompt builder needs to map this correctly.
5. `SelfReplyQueue.our_post_id` refs `Post` collection — confirm this is the CEO's own posts, not KOL posts.
