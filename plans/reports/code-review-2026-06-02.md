# Code Review — KOL Crawl Pipeline Refactor

**Date:** 2026-06-02
**Reviewer:** code-reviewer
**Verdict:** **APPROVE** (with minor follow-ups)

## Scope
- Files: 14 modified, 3 new (`kolScheduleService.ts`, `migrateKolSettingsPrimeWindow.ts`, `kolScheduleService.test.ts`), 5 deleted (3 stream + `kolCrawlCron.ts` + `crawlDueKols`)
- LOC: +311 / -648
- Test run: **113/113 pass** (10 new, 103 existing)

## Overall Assessment
Solid, focused refactor. Stream code is fully excised (only the changelog mentions it). Schedule logic is properly extracted; daemon is a thin wrapper. Schema validation matches route validation. Prime-window edge cases (wrap-around midnight, empty window) are tested. Webhook contract at `routes/tasks.ts:296-310` matches the new `payload.sinceByHandle` shape. No security, data-loss, or breaking-change risks found.

## Critical
None.

## Major
1. **Doc count mismatch** — `docs/codebase-summary.md:25` says `(12 services)` but `ls src/services/*.ts | wc -l` = 13. Table at line 56 says `## Services (13 Total)` (correct). Fix line 25 to `(13 services)`.
2. **Test coverage gaps** in `src/tests/kolScheduleService.test.ts`:
   - `runPrimePolling` mutex short-circuit (analogous to the tested `runBatchCrawl` mutex) — missing.
   - `createBatchCrawlTasks` with one failing `Task.create` (the `try/catch` in `kolCrawlerService.ts:640-671` is the actual claim) — not exercised.
   - `forceAll: true` semantics — not tested.
   - Migration script has **zero tests**. Re-running on an already-migrated doc should be a no-op (`migrateKolSettingsPrimeWindow.ts:31-38`); worth a smoke test.
3. **Misleading test name** — `KolSettings defaults` (test file line 103) does not exercise schema defaults; it just checks a mocked return value. Either rename or instantiate the real schema and assert `prime_window: { start_hour: 9, end_hour: 13 }`.

## Minor
1. **`IRunBatchCrawlResult.skipped` unit confusion** — `kolScheduleService.ts:104` returns `skipped: tiers.length` (number of tiers passed), not number of KOLs. The `created` field is KOL count. Inconsistent units — consider returning the number of KOLs that *would* have been due, or rename to `skippedTiers`.
2. **`end_hour: 24` allowed** — schema (`KolSettings.ts:118`) and route (`kolSettings.ts:214`) accept `1..24`. `getUTCHours()` returns `0..23`, so `h < 24` is always true. Functionally fine (means "end at next midnight") but the max=24 is non-obvious; a comment or min/max doc string would help.
3. **`runBatchCrawl` swallows skipped-handle detail** — `result.skipped` is a count only; the actual skipped handles are inside `createBatchCrawlTasks.result.skipped` and not bubbled up. Useful for ops debugging.
4. **`isMainModule` detection** — `migrateKolSettingsPrimeWindow.ts:67-70` uses `process.argv[1].endsWith`. Works but fragile under bundlers/tsx-watch. Acceptable for a one-shot script.
5. **Changelog claim "Cron Jobs (12 Total)"** — `docs/codebase-summary.md:103` was 9 before. New jobs: `kol-prime-poll`, `kol-batch-S-A`, `kol-batch-B`, `kol-batch-C` = +4 = 13, not 12. The header says 12. Verify and fix.

## Edge-Case Spot Checks

| Check | Result |
|---|---|
| `isWithinPrimeWindow` 22..2 wrap-around (h=22, 23, 0, 1 in; h=2, 21 out) | Pass — tested `test:83-92` |
| `isWithinPrimeWindow` empty window (start === end) | Pass — tested `test:94-98` |
| Prime window end exclusive (h=12:59 in, h=13:00 out) | Pass — tested `test:73, 79` |
| `runBatchCrawl` mutex held — second call short-circuits | Pass — tested `test:194-207`; relies on synchronous `isBatchCrawling = true` (line 106) before any await |
| `createBatchCrawlTasks` per-KOL try/catch — one fail doesn't kill others | Pass — `kolCrawlerService.ts:637-674` uses `Promise.allSettled` + inner `try/catch`; mutex protects shared `result` object via JS single-threaded model |
| Migration idempotency on already-migrated doc | Correct logic (`migrateKolSettingsPrimeWindow.ts:31-38`) but **no test** |
| `payload.sinceByHandle` shape matches `routes/tasks.ts:298` cast | Match — `kolCrawlerService.ts:658` produces `Record<string, string>`, webhook reads the same |
| `payload.handles: [kol.handle]` vs `processBatchCrawlResult` expects `handles: string[]` | Match |
| Deleted files leave no dangling imports/refs | Confirmed — `grep -r "kolStream\|xStream\|crawlDueKols" src/` returns zero |
| `package.json` `stream:kol` removed | Confirmed absent |

## Praise
- **Test pass rate 100%** (113/113). Fast suite (~500ms).
- **Excellent wrap-around test** for `isWithinPrimeWindow` — the kind of edge case that usually ships broken.
- **Mutex design is correct** — synchronous flag set before any `await` means the second concurrent call short-circuits without a race.
- **Idempotent migration** — checks for valid pre-existing values before writing, uses `$set` with dotted paths so a partial pre-state is safely backfilled.
- **Clean separation** — `kolScheduleService` is pure logic, daemon is a thin cron wrapper, factory lives in `kolCrawlerService`. Easy to test, easy to reason about.
- **Prime-window schema choice** — `end_hour` exclusive is the right call (avoids the "do I run at 13:00?" ambiguity).
- **The new `docs/notes/prime-window-and-batch-schedule.md`** clearly explains *why* (X API tier limits, cost-quality trade, why each tier has its own interval).
- **No `any` introduced**, no unsafe casts beyond the established `as Error` pattern.

## Recommended Next Steps
1. Fix `docs/codebase-summary.md:25` service count to 13 (and verify line 103 cron count).
2. Add the 4 missing test cases listed in Major #2 — collectively ~50 lines.
3. Rename `KolSettings defaults` test to match what it actually tests, or instantiate the real schema.
4. Optional: bubble up `skipped` handle list from `runBatchCrawl` for ops visibility.

## Metrics
- Type Coverage: high (no `any` introduced)
- Test Coverage on new code: ~70% (mutex short-circuit on prime path + forceAll + migration untested)
- Linting: not run separately; tsc compiles, all tests pass
- New files under 200 lines: `kolScheduleService.ts` (122), migration (77), test (234 — split recommended)

## Unresolved Questions
- Confirm intended cron count: new jobs are 4 KOL-crawl + 8 existing = 12? Or 4 + 7 = 11? Header says "12 Total"; verify.
- Confirm `tier_crawl_intervals.S` default change (120 → 15) is intentional — any existing KOLs in the DB with the old default would be unaffected since the schema default only applies on doc creation, but the comment in `runPrimePolling` (`kolScheduleService.ts:46`) uses this value, so the meaning is "poll cadence inside prime window" rather than "batch cadence". Clear from code but worth a doc note.
