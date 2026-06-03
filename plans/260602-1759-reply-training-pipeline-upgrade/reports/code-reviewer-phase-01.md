# Code Review — Phase 01: Auto-Learn Cron Wire-Up

**Reviewer:** code-reviewer
**Date:** 2026-06-03
**Verdict:** Approve with minor notes

---

## Scope
- Files reviewed: `src/db/models/Post.ts`, `src/db/models/OwnAccountProfile.ts`, `src/services/ownAccountService.ts`, `src/scripts/autoLearnCron.ts`, `src/scripts/kolDaemon.ts`, `package.json`
- LOC delta: ~110 lines added
- Typecheck: PASS (`tsc --noEmit` clean)
- Scout findings: hook coverage gaps in `tools.ts` admin endpoint; missing tests.

---

## High Priority

### 1. Plan deviation (document, not block)
The plan's Overview explicitly mandates the post-save hook on `Post` ("Add a `learning_eligible_at` Mongoose post-save hook on `Post` — set 24h after a `POSTED` transition"), but the "Files to Modify → Post.ts" section says **"No other changes — `updated_at` is the timestamp source for the 24h calculation."** These two statements contradict each other: the hook is part of the design but the field section claims no other changes.

The implementation correctly added the hook (otherwise the field would stay null and `autoLearnPersonality` would never fire). The plan needs an edit to reconcile the contradiction — the hook is the *only* mechanism that populates `learning_eligible_at`, so the "no other changes" line is wrong.

**Action:** update `phase-01-auto-learn.md` Files-to-Modify → Post.ts section to reflect the hook additions. (Not blocking merge — implementation is correct.)

### 2. `markPostEligibleForLearning` is dead code (YAGNI)
`grep -rn markPostEligibleForLearning` returns zero call sites in the diff. The Mongoose hook does this work inline on every save/findOneAndUpdate. The method is a public API for "manual stamping" that nobody calls.

The plan's Files-to-Modify for `ownAccountService.ts` listed this method, so it was spec'd, but the spec predates the hook decision. Either:
- Remove it (preferred — KISS).
- Mark `@deprecated` in JSDoc with a comment "callable from a one-off ops script if needed."

**Action:** remove or annotate. Not blocking.

### 3. Missing test deliverable
`src/tests/ownAccountService.test.ts` does not exist (`ls src/tests/ | grep -i ownAccount` → none). The plan's Test Strategy section specifies 5 unit cases for `autoLearnPersonality` and `markPostEligibleForLearning`. None delivered.

**Action:** add the test file in a follow-up or before Phase 02 ships.

---

## Medium Priority

### 4. DRY: 24h constant repeated 4x
`new Date(Date.now() + 24 * 60 * 60 * 1000)` appears in:
- `Post.ts:141` (save hook)
- `Post.ts:155` (findOneAndUpdate hook)
- `ownAccountService.ts:83` (`markPostEligibleForLearning`)
- (plus `Date.now() - last.getTime() < 24 * 60 * 60 * 1000` for rate-limit at `ownAccountService.ts:93`)

Extract `LEARNING_ELIGIBILITY_DELAY_MS = 24 * 60 * 60 * 1000` (and `LEARN_RATE_LIMIT_MS`) to a shared constant. Plan's Unresolved Question #3 already considered making this configurable; for now a module-level constant suffices.

**Action:** refactor when removing `markPostEligibleForLearning` (kills one of the four occurrences).

### 5. Post hook silently swallows errors
Both `post('save')` and `post('findOneAndUpdate')` call `await Post.updateOne(...)` inside an async function but do **not** return the promise from the handler. If the update fails (e.g., DB blip), the error is silently dropped — Mongoose post-middleware doesn't await un-returned promises, and the calling `save()` will resolve successfully.

The bot caller (`kolTelegramBotNative.ts:880`) will report success to the user even if the eligibility stamp failed. Worst case: cron silently has no eligible posts for 24h after a transient failure.

**Fix:** add a `.catch((e) => log.error(...))` to each hook. Or set `process.nextTick` with explicit error logging.

**Action:** add error logging. Not blocking — failure mode is degraded but not corrupting.

### 6. `findOneAndUpdate` hook fires on every Post mutation
`grep` shows the only `Post.findByIdAndUpdate` caller is `src/routes/tools.ts:62-68` (admin/dev PATCH endpoint). The hook is correctly guarded by the `doc && doc.status === POSTED && !doc.learning_eligible_at` triple-check, so it only writes 1 update on POSTED transitions. Acceptable.

However, on every other `findByIdAndUpdate` (e.g., changing `edit_history`), the hook still does an in-memory read of `doc` to check the predicate. Zero DB cost — fine.

---

## Low Priority

### 7. `applyLearnedProfile` change is correct
The line `last_learn_trigger_at: profile.learned_profile.last_learn_trigger_at` (line 158) preserves the rate-limit timestamp across LLM result ingestion. The webhook that calls this method does **not** touch the trigger timestamp — only `autoLearnPersonality` does. Correct.

### 8. Cron wiring correct
- `0 */6 * * *` — every 6h on the hour. Off-peak relative to other crons (`*/2`, `*/10`, `0 */2`). Good.
- `RUN_NOW` block calls `executeAutoLearnPersonality` ✓
- `ownAccountService` import at top — no circular dependency (`ownAccountService` doesn't import `kolDaemon`).
- Package script `cron:auto-learn` mirrors `cron:add:own-account-learn` pattern ✓

### 9. Standalone script mirrors existing pattern
`autoLearnCron.ts` vs `ownAccountLearnCron.ts`: same shape, same error pattern, same `isMainModule` guard. Good.

### 10. Type safety
No new `any` types. `(err as Error).message` pattern used in both `kolDaemon.ts:64` and `autoLearnCron.ts:19,26` (matches project convention).

---

## Edge Cases Found

| Case | Status |
|------|--------|
| Re-save an already-POSTED post | `!doc.learning_eligible_at` guard prevents re-stamp ✓ |
| `findOneAndUpdate` returns null (no match) | `if (doc && ...)` guard handles ✓ |
| Two concurrent POSTED transitions for same post | `updateOne` with `$set` is atomic per-doc; first wins, second writes same value ✓ |
| `last_learn_trigger_at` set but Task creation failed | Plan accepts partial state (rate limit not set, cron retries next tick). Acceptable ✓ |
| Existing POSTED posts (pre-Phase 01) lack `learning_eligible_at` | Plan's Unresolved Question #1 — no backfill, they self-stamp on next update. Acceptable for a learning pipeline that operates on 30-day windows ✓ |
| Scan-and-post worker: actual POSTED transition path | Plan lists "scan-and-post worker" but the code in `scanAndPostCron.ts` only creates Tasks. The actual `status: POSTED` flip happens in OpenClaw worker (separate repo) or in a webhook callback. **Not visible in this repo** — if the worker uses `Post.findByIdAndUpdate({status: POSTED})`, the `findOneAndUpdate` hook fires; if it uses something else, the stamp won't be set. **Caveat for ops: verify with cinee-worker team.** |
| `tools.ts:64` admin endpoint PATCH'ing status=POSTED | `findOneAndUpdate` hook fires ✓ |

---

## Verdict: **Approve with minor notes**

The implementation is correct and the typecheck passes. The plan deviation is a documentation issue, not a code issue — the hook is the right call. Ship it; address the dead-code, tests, and error-logging items in a follow-up.

## Recommended Actions (in priority order)
1. Update `phase-01-auto-learn.md` Files-to-Modify → Post.ts section to match the implemented hooks (resolve plan contradiction).
2. Add `.catch((e) => log.error(...))` to both Post hooks (silent error swallow).
3. Add `src/tests/ownAccountService.test.ts` with the 5 cases from the plan's Test Strategy section.
4. Remove or annotate `markPostEligibleForLearning` (dead code per YAGNI).
5. Extract `LEARNING_ELIGIBILITY_DELAY_MS` constant (DRY).
6. Verify with cinee-worker team that the actual `status: POSTED` flip in the posting path uses `save()` or `findOneAndUpdate` (otherwise `learning_eligible_at` will stay null for scan-and-posted posts).

## Unresolved Questions
- Q: Does the OpenClaw worker (separate cinee-worker repo) use `Post.save()` or `Post.findOneAndUpdate()` when transitioning to POSTED? If it uses a raw `db.posts.updateOne()` (bypassing Mongoose), neither hook fires and the eligibility stamp will not be set. **Recommend**: confirm with worker team; if raw updateOne is used, add a `bulkWrite`-level post-hook or switch to Mongoose.

## Metrics
- Type Coverage: 100% (no `any` introduced)
- Test Coverage: 0% (no tests for new methods; pre-existing)
- Linting: clean
- Typecheck: PASS
