# Phase 01 — Auto-Learn Hook

**Priority:** Critical (blocks Phase 02)
**Status:** Pending
**Blocked by:** none
**Blocks:** Phase 02

---

## Context Links

- Current learning service: `src/services/ownAccountService.ts:41-75` (`learnPersonality`)
- Existing learn script: `src/scripts/ownAccountLearnCron.ts` (not in any daemon)
- Active daemon: `src/scripts/kolDaemon.ts` (single source of truth for cron ticks)
- Post model: `src/db/models/Post.ts` (no `posted_at` field — uses `updated_at`)
- Status transitions to POSTED: `src/telegram/kolTelegramBotNative.ts:885`, `src/services/ownAccountCrawlerService.ts:159,192`, scan-and-post worker
- Singleton model: `src/db/models/OwnAccountProfile.ts` (sub-doc pattern)

---

## Overview

The bot's "training" today is purely prompt-based — no model fine-tuning. `learnPersonality()` already exists and works. The gap is **invocation**: nothing calls it on a steady cadence, and the singleton profile goes stale. Three things change:

1. Add a `last_learn_trigger_at` field on `OwnAccountProfile` (rate-limit per-account).
2. Add a `learning_eligible_at` Mongoose post-save hook on `Post` — set 24h after a `POSTED` transition. Cron watches for posts that crossed the threshold and are unanalyzed.
3. Add an auto-learn tick to `kolDaemon` (every 6h) that picks eligible posts and queues a learning task — but only if the rate-limit allows (1×/day/singleton).

Why a cron sweep (option 3) instead of a direct call from the post-save hook (option 2 in the request):
- Direct injection of OpenClaw work into an HTTP request path is fragile (OpenClaw worker may be down, request times out).
- Cron sweep is idempotent — multiple `POSTED` posts in a window produce one learning task, not 50.
- Cron sweep respects rate limits naturally.

---

## Requirements

- +24h delay between `Post.status = POSTED` and the learning-eligibility trigger
- Max 1 learning run per 24h (rate-limited on `OwnAccountProfile.last_learn_trigger_at`)
- Triggered automatically by `kolDaemon` (no manual `npm run cron:add:own-account-learn` step)
- Existing on-demand `POST /api/account/personality/learn` still works (manual override)
- Logging: every decision (skipped due to rate-limit, skipped due to <10 posts, queued task ID)

---

## Files to Modify

### `src/db/models/Post.ts`

Add `learning_eligible_at?: Date` field (Date, optional, indexed). No other changes — `updated_at` is the timestamp source for the 24h calculation.

```typescript
learning_eligible_at: { type: Date, default: null, index: true },
```

Also add index: `postSchema.index({ status: 1, learning_eligible_at: 1 })` — for the cron sweep query.

### `src/db/models/OwnAccountProfile.ts`

Add to `IOwnAccountLearnedProfile` sub-doc:
```typescript
last_learn_trigger_at: Date | null;  // For cron rate-limit (1×/day)
```

Default: `null`. No new index needed (singleton).

### `src/services/ownAccountService.ts`

Add two methods:

```typescript
// New: stamp learning_eligible_at = updated_at + 24h on POSTED transition
async markPostEligibleForLearning(postId: string): Promise<void> {
  const post = await Post.findById(postId).select("status updated_at learning_eligible_at");
  if (!post || post.status !== EPostStatus.POSTED) return;
  if (post.learning_eligible_at) return;  // already stamped
  const eligibleAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await Post.updateOne({ _id: postId }, { $set: { learning_eligible_at: eligibleAt } });
}

// New: cron entry point. Returns taskId or null.
async autoLearnPersonality(): Promise<string | null> {
  const profile = await this.getProfile();
  const last = profile.learned_profile.last_learn_trigger_at;
  if (last && Date.now() - last.getTime() < 24 * 60 * 60 * 1000) {
    log.info(`[OwnAccount] Auto-learn skipped — last trigger ${Math.round((Date.now() - last.getTime()) / 3600000)}h ago (< 24h)`);
    return null;
  }

  // Find any unanalyzed eligible post — confirms the 24h delay is satisfied
  const eligiblePost = await Post.findOne({
    status: EPostStatus.POSTED,
    learning_eligible_at: { $lte: new Date(), $ne: null },
  }).select("_id").lean();
  if (!eligiblePost) {
    log.info("[OwnAccount] Auto-learn skipped — no eligible POSTED posts past 24h");
    return null;
  }

  // Reuse existing learnPersonality() — same Post query, same threshold, same Task creation
  const taskId = await this.learnPersonality();
  if (taskId) {
    profile.learned_profile.last_learn_trigger_at = new Date();
    await profile.save();
  }
  return taskId;
}
```

`learnPersonality()` itself does not need to change — the existing 30-day Post query, 1-post minimum (`MIN_POSTS_REQUIRED = 1`), and OpenClaw task creation all work. We just re-use it.

### `src/scripts/kolDaemon.ts`

Add new cron tick. Insert after the existing `executeSelfReplies` block (around line 56):

```typescript
async function executeAutoLearnPersonality() {
  log.info("[KOLDaemon] Auto-learn personality tick…");
  try {
    const taskId = await ownAccountService.autoLearnPersonality();
    if (taskId) {
      log.info(`[KOLDaemon] Auto-learn queued task: ${taskId}`);
    }
  } catch (err: unknown) {
    log.error(`[KOLDaemon] Auto-learn crashed: ${(err as Error).message}`);
  }
}
```

And import + schedule (around line 19 and 134):

```typescript
import { ownAccountService } from "../services/ownAccountService.js";
// ...
cron.schedule("0 */6 * * *", executeAutoLearnPersonality);  // every 6h
```

Cron: every 6h, off-peak (00:00, 06:00, 12:00, 18:00 server-local). Server-local is fine — the 24h rate limit is absolute, not window-aligned.

Add `executeAutoLearnPersonality` to the `RUN_NOW` block at the top of `startDaemon()` (line 119) for `--run-now` dev mode.

---

## Files to Create

### `src/scripts/autoLearnCron.ts` (~30 lines)

Standalone script mirroring `ownAccountLearnCron.ts` but calling the new `autoLearnPersonality()`. Used for manual `npm run cron:trigger:auto-learn` (optional — added in package.json).

```typescript
/** AutoLearnCron — Periodic auto-learn trigger (24h rate-limited). */
import { ownAccountService } from "../services/ownAccountService.js";
import { connectDb, disconnectDb } from "../db/connection.js";
import { log } from "../utils/logger.js";

async function main(): Promise<void> {
  try {
    await connectDb();
    log.info("[AutoLearnCron] Triggering auto-learn…");
    const taskId = await ownAccountService.autoLearnPersonality();
    if (taskId) {
      log.info(`[AutoLearnCron] Queued: ${taskId}`);
    } else {
      log.info("[AutoLearnCron] Skipped (rate-limited or no eligible posts)");
    }
    await disconnectDb();
    process.exit(0);
  } catch (error) {
    log.error(`[AutoLearnCron] Fatal: ${(error as Error).message}`);
    await disconnectDb().catch(() => {});
    process.exit(1);
  }
}

const isMainModule = process.argv[1] && (
  process.argv[1].endsWith("autoLearnCron.ts") ||
  process.argv[1].endsWith("autoLearnCron.js")
);
if (isMainModule) main();
export { main as runAutoLearnCron };
```

### `package.json`

Add script entry (mirrors existing pattern):
```json
"cron:auto-learn": "tsx src/scripts/autoLearnCron.ts"
```

---

## Files to Delete

**None.** The existing `src/scripts/ownAccountLearnCron.ts` stays for backwards compatibility (manual one-off `npm run cron:add:own-account-learn` still works). After Phase 1 ships for a week, we can deprecate it.

---

## Implementation Steps

1. Add `learning_eligible_at` field + index to `src/db/models/Post.ts`.
2. Add `last_learn_trigger_at` to `IOwnAccountLearnedProfile` in `src/db/models/OwnAccountProfile.ts`.
3. Add `markPostEligibleForLearning()` and `autoLearnPersonality()` to `ownAccountService.ts`.
4. Create `src/scripts/autoLearnCron.ts`.
5. Add `cron:auto-learn` to `package.json`.
6. Wire `executeAutoLearnPersonality` into `kolDaemon.ts` (import + cron + RUN_NOW).
7. Run `npm run typecheck`. Fix any TS errors.
8. Manual smoke test: trigger a `Post.status = POSTED` transition, run `npm run cron:auto-learn`, confirm task queued (or skipped with correct log line).

---

## Todo List

- [ ] Add `learning_eligible_at` field + compound index to `Post` model
- [ ] Add `last_learn_trigger_at` to `IOwnAccountLearnedProfile` interface
- [ ] Add `markPostEligibleForLearning()` to `ownAccountService`
- [ ] Add `autoLearnPersonality()` to `ownAccountService`
- [ ] Create `src/scripts/autoLearnCron.ts`
- [ ] Add `cron:auto-learn` script to `package.json`
- [ ] Wire `executeAutoLearnPersonality` into `kolDaemon.ts` (import, cron, RUN_NOW)
- [ ] Run `npm run typecheck` — must pass
- [ ] Manual: trigger POSTED, run cron, confirm log output

---

## Success Criteria

- `Post.learning_eligible_at` is auto-set 24h after a status=POSTED transition.
- `kolDaemon` ticks `executeAutoLearnPersonality` every 6h without manual setup.
- Within 24h of a POSTED transition, exactly one `payload.analysisType="own_account_personality"` Task is created.
- Calling `autoLearnPersonality()` twice within 24h produces exactly one Task (rate-limited).
- Existing `POST /api/account/personality/learn` still works (does not check rate limit).

---

## Test Strategy

**Unit** (`src/tests/ownAccountService.test.ts`, new file):
- `autoLearnPersonality` returns null when `last_learn_trigger_at < 24h` ago.
- `autoLearnPersonality` returns null when no POSTED post has `learning_eligible_at <= now`.
- `autoLearnPersonality` calls `learnPersonality` when both gates pass; sets `last_learn_trigger_at`.
- `markPostEligibleForLearning` is a no-op for non-POSTED status.
- `markPostEligibleForLearning` is idempotent (second call doesn't overwrite).

**Integration** (manual):
- `npm run cron:auto-learn` with empty DB → log "no eligible posts", exit 0.
- Create a `Post` with `status=POSTED, learning_eligible_at=past` → cron logs task ID, Task record exists in DB.
- Re-run cron immediately → log "rate-limited", no new Task.

**Cron wiring** (manual):
- `npm run kol:daemon -- --run-now` → log line `[KOLDaemon] Auto-learn personality tick…` appears.
- Wait 6h in production (or temporarily change cron to `*/5 * * * *` for dev) → second log line appears.

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| OpenClaw worker is down when cron runs | Medium | Cron just queues Task; OpenClaw retries on its own schedule. No data loss. |
| 30-day window + 24h delay = learning only catches stale posts | High (intentional) | Documented. The first 30 days after bot launch have no learned data. This is correct — the bot needs the CEO's real writing first. |
| `MIN_POSTS_REQUIRED = 1` is too low — single AI-generated post creates a learned profile | Medium | Currently `1` (per `ownAccountService.ts:15`). Phase 1 does not change this. Phase 2/3 will measure the impact. If the eval log (Phase 3) shows edit_ratio = 100% on learned profiles with <5 posts, raise the threshold in a Phase 1.1 follow-up. |
| LLM bias loop: AI writes tweet → LLM learns from it → AI writes more like itself | **High** | Flagged as the project-level risk in the request. Phase 3 (eval log with `edit_ratio`) is the mitigation. If `edit_ratio` doesn't improve over time, the learned profile is mirroring LLM output, not the CEO. |
| Existing `ownAccountLearnCron.ts` (manual) becomes redundant | Low | Keep it for one-off ops. Document in `README` that auto is preferred. |
| `kolDaemon` doesn't restart in prod to pick up the new cron | Medium | Document in deploy notes. Or use `process.exit(0)` after deploy to let process manager restart. |

---

## Security Considerations

- `learning_eligible_at` and `last_learn_trigger_at` are server-side controlled. No external input.
- The 24h rate limit prevents DOS via repeated seed-post → learn → seed-post cycles.
- The `payload.analysisType="own_account_personality"` discriminator is already used by the existing webhook (`src/routes/tasks.ts:241`) — no new payload shape needed.

---

## Unresolved Questions

1. **Should the cron also stamp `learning_eligible_at` on existing POSTED posts that lack it?** (Backfill question — yes via a one-time migration script, or let it happen naturally for new POSTED transitions only.) **Recommendation: do nothing — let new POSTED transitions self-stamp. Migration adds risk for marginal value.**
2. **What happens if a POSTED post is later edited (status flips back to EDITING)?** The current model has no state machine guard. Phase 1 leaves this alone — `learning_eligible_at` is set once and stays. If the post is re-posted later, it will be re-stamped (we can revisit in Phase 2 if eval shows drift).
3. **Should the +24h delay be configurable via env var?** (E.g. `OWN_LEARN_DELAY_HOURS=24`.) **Recommendation: YAGNI for now — hardcode 24h, add env var only if requested.**

---

## Next Steps

Phase 02 reads `OwnAccountProfile.effective_profile` from the same `ownAccountService.getProfile()` call already used by `replyEngineService:184` — so wiring is local to `promptBuilder.ts`.
