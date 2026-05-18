# Phase 02 — Manual Confirm Service Logic

**Priority:** Critical (blocks Phase 3 + 4)
**Status:** Pending

---

## Context Links

- Service: `src/services/replyEngineService.ts`
- Current manual routing: `processGeneratedSuggestions()` line 234-239
- AFK logic to reuse: `processAFKMode()` line 255-295

---

## Overview

Change the Manual mode flow in `processGeneratedSuggestions()` to pre-select the best suggestion (reusing AFK confidence/quality logic) before sending to Telegram.

---

## Implementation Steps

### 1. Extract shared selection logic from `processAFKMode()`

Create a private method that both AFK and Manual can use:

```typescript
/**
 * Select best suggestion by confidence threshold + quality check.
 * Returns the selected suggestion or null if none qualifies.
 */
private async selectBestSuggestion(
  suggestion: IKolReplySuggestion,
): Promise<ISuggestion | null> {
  const settings = await KolSettings.getSettings();
  const minConfidence = settings.afk.min_confidence_threshold;

  const bestSuggestion = suggestion.suggestions
    .filter((s) => s.confidence >= minConfidence)
    .sort((a, b) => b.confidence - a.confidence)[0];

  if (!bestSuggestion) return null;

  // Quality check
  const post = await KolPost.findById(suggestion.kol_post_id);
  if (!post || post.analysis.virality_score < 30) return null;

  return bestSuggestion;
}
```

### 2. Update Manual mode routing in `processGeneratedSuggestions()`

```typescript
} else {
  // Manual mode: pre-select best, then send confirmation
  const best = await this.selectBestSuggestion(suggestion);
  
  if (best) {
    // Pre-select and send streamlined confirmation
    suggestion.selected_suggestion_id = best.id;
    await suggestion.save();
    
    const { sendConfirmationRequest } = await import("../telegram/kolTelegramBotNative.js");
    await sendConfirmationRequest(suggestion);
  } else {
    // No good suggestion — show full list for manual pick
    const { sendSuggestionForReview } = await import("../telegram/kolTelegramBotNative.js");
    await sendSuggestionForReview(suggestion);
  }
}
```

### 3. Refactor `processAFKMode()` to use `selectBestSuggestion()`

```typescript
private async processAFKMode(suggestion: IKolReplySuggestion): Promise<void> {
  const best = await this.selectBestSuggestion(suggestion);

  if (!best) {
    await this.convertToManualMode(suggestion);
    return;
  }

  // Schedule with random delay
  const settings = await KolSettings.getSettings();
  const delayMin = settings.afk.auto_delay_min_minutes;
  const delayMax = settings.afk.auto_delay_max_minutes;
  const delayMinutes = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;

  suggestion.selected_suggestion_id = best.id;
  suggestion.auto_reply_scheduled_at = new Date(Date.now() + delayMinutes * 60 * 1000);
  await suggestion.save();
}
```

### 4. Add `runAutoRejectExpired()` method

```typescript
/**
 * Auto-reject manual suggestions that exceeded the timeout.
 */
async runAutoRejectExpired(): Promise<{ rejected: number }> {
  const settings = await KolSettings.getSettings();
  const timeoutMinutes = settings.manual.auto_reject_after_minutes;
  const cutoff = new Date(Date.now() - timeoutMinutes * 60 * 1000);

  const expired = await KolReplySuggestion.find({
    mode: EReplyMode.MANUAL,
    execution_status: EReplyExecutionStatus.PENDING,
    admin_decision: { $exists: false },
    created_at: { $lte: cutoff },
  });

  for (const suggestion of expired) {
    suggestion.admin_decision = EAdminDecision.REJECTED;
    suggestion.admin_decided_at = new Date();
    suggestion.execution_status = EReplyExecutionStatus.FAILED;
    suggestion.error_message = "Auto-rejected: no response within timeout";
    await suggestion.save();
  }

  if (expired.length > 0) {
    log.info(`[ReplyEngine] Auto-rejected ${expired.length} expired suggestions`);
  }

  return { rejected: expired.length };
}
```

---

## Done When

- [ ] `selectBestSuggestion()` extracted as shared method
- [ ] Manual mode pre-selects best and calls `sendConfirmationRequest()`
- [ ] Falls back to `sendSuggestionForReview()` when no good suggestion
- [ ] `processAFKMode()` refactored to use shared method
- [ ] `runAutoRejectExpired()` method added
- [ ] `npx tsc --noEmit` passes
