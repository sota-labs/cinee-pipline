# Phase 5 — Tests

## Context Links
- Current tests: `src/tests/kolCrawlerIntegration.test.ts`
- Other test files (read for context): `src/tests/kolCrawlScript.test.ts`, `src/tests/kolCrawlResultParser.test.ts`, `src/tests/xApiClient.test.ts`, `src/tests/xResultMapper.test.ts`, `src/tests/enums.test.ts`

## Overview
- **Priority**: P2
- **Status**: pending
- **Description**: Update `kolCrawlerIntegration.test.ts` to (a) drop any indirect assumptions about the stream path, (b) add coverage for `createBatchCrawlTasks`, `executePrimePolling`, the prime-window helper, and the new KolSettings fields. Keep all existing `processCrawlResults` and `crawlKol` tests as-is (they're still valid).

## Requirements

### Functional

1. **Keep existing tests**:
   - `KolCrawlerService.crawlKol` — happy path, XRateLimitError, XUserNotFoundError.
   - `processCrawlResults` — saves new posts, drops retweets, skips duplicates, drops short content.
   - These do not touch the stream and remain valid after Phase 4 deletion.

2. **Add new tests** (new `describe` blocks):
   - `isWithinPrimeWindow(pw, now)`:
     - Normal window, current hour in `[start, end)` → true.
     - Outside window → false.
     - Wrap-around midnight (e.g. start=22, end=2): hours 22, 23, 0, 1 → true; hours 2..21 → false.
     - start === end → false (empty window).
   - `KolSettings` defaults:
     - Fresh doc has `prime_window = { start_hour: 9, end_hour: 13 }`.
     - Fresh doc has `tier_batch_intervals = { A: 120, B: 180, C: 240 }`.
   - `createBatchCrawlTasks(["A"])`:
     - With 3 active Tier A KOLs due → exactly 3 `Task.create` calls.
     - Each Task has `payload.action === "batch_crawl"`, `payload.handles.length === 1`, `payload.handle_group === <handle>`, `payload.sinceByHandle[<handle>]` is an ISO string.
     - `Task.create` throwing once → 2 created, 1 skipped, no abort.
     - With `forceAll: true` → every active KOL in tier is enqueued regardless of `last_crawled_at`.
   - `executePrimePolling` (extract logic to a testable function or test via `kolDaemon` import — see below):
     - When `Date.now()` is outside prime window → no `crawlKol` calls.
     - When inside prime window + 2 active Tier S KOLs → 2 `crawlKol` calls.
     - When `isPrimePolling` mutex is set → second call short-circuits (no `crawlKol`).
   - Route validation: `PATCH /api/kol-settings` with `prime_window = { start_hour: 13, end_hour: 9 }` (inverted) → 400.
   - Route validation: `PATCH /api/kol-settings` with `tier_batch_intervals.B = 1` → clamped to 30, no error.

3. **Test refactoring for testability**:
   - The cron-scheduled functions in `kolDaemon.ts` (e.g. `executePrimePolling`) are not exported. Two options:
     - **(a) Export the cron functions** (rename to `runPrimePolling`, export, then `cron.schedule` calls the local name). Pros: simple. Cons: pollutes the public API of the script.
     - **(b) Extract logic to a function in `kolCrawlerService` or new `src/services/kolScheduleService.ts`**, have `kolDaemon.ts` call it. Pros: testable without booting the daemon. Cons: more files.
   - **Decision: option (b)** — extract `runPrimePolling()` to a new `src/services/kolScheduleService.ts`. `kolDaemon.ts` becomes a thin scheduler wrapper. This also keeps `kolDaemon.ts` under 200 lines (it's currently 156 — adding two more functions and three more cron lines keeps it under, but option (b) is also cleaner architecturally).

### Non-functional
- All new tests use the existing `vi.mock(...)` pattern with mocked `Task.create` to avoid hitting the real DB.
- No new test framework dependencies.

## Architecture

### New service: `src/services/kolScheduleService.ts`
```typescript
// ~80 lines
import { KolSettings, isWithinPrimeWindow } from "../db/models/KolSettings.js";
import { createBatchCrawlTasks, kolCrawlerService } from "./kolCrawlerService.js";
import { KolProfile } from "../db/models/KolProfile.js";
import pLimit from "p-limit";
import { log } from "../utils/logger.js";
import { XRateLimitError } from "./platforms/x/xApiClient.js";

let isPrimePolling = false;
let isBatchCrawling = false;

export async function runPrimePolling(): Promise<{ polled: number; skipped: boolean }> {
  if (isPrimePolling) { log.warn("[KolSchedule] Prime poll in progress, skipping"); return { polled: 0, skipped: true }; }
  isPrimePolling = true;
  try {
    const settings = await KolSettings.getSettings();
    if (!isWithinPrimeWindow(settings.prime_window, new Date())) {
      log.debug("[KolSchedule] Outside prime window, skipping Tier S poll");
      return { polled: 0, skipped: false };
    }
    const minTrust = settings.safety.min_kol_trust_score;
    const cutoff = new Date(Date.now() - settings.tier_crawl_intervals.S * 60_000);
    const kols = await KolProfile.find({ is_active: true, reputation_score: { $gte: minTrust }, tier: "S",
      $or: [{ last_crawled_at: null }, { last_crawled_at: { $lte: cutoff } }] });
    if (kols.length === 0) return { polled: 0, skipped: false };
    const limit = pLimit(settings.crawl_concurrency);
    let rateLimited = false;
    const results = await Promise.allSettled(kols.map(k => limit(async () => {
      if (rateLimited) return null;
      await kolCrawlerService.crawlKol(k, { limit: settings.max_posts_per_crawl });
      return k.handle;
    })));
    let count = 0;
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) count++;
      else if (r.status === "rejected" && r.reason instanceof XRateLimitError) rateLimited = true;
    }
    return { polled: count, skipped: false };
  } finally { isPrimePolling = false; }
}

export async function runBatchCrawl(tiers: Array<"S"|"A"|"B"|"C">): Promise<{ created: number; skipped: number }> {
  if (isBatchCrawling) { log.warn("[KolSchedule] Batch crawl in progress, skipping"); return { created: 0, skipped: tiers.length }; }
  isBatchCrawling = true;
  try {
    const result = await createBatchCrawlTasks(tiers);
    return { created: result.tasksCreated, skipped: result.skipped.length };
  } finally { isBatchCrawling = false; }
}
```

## Related Code Files

### Create
- `src/services/kolScheduleService.ts` — extracted runnable functions.
- `src/tests/kolScheduleService.test.ts` — new tests.

### Modify
- `src/scripts/kolDaemon.ts` — import `runPrimePolling` and `runBatchCrawl` from `kolScheduleService`; remove inline `executePrimePolling`/`executeBatchCrawl`; remove mutexes (moved).
- `src/tests/kolCrawlerIntegration.test.ts` — no required change (existing tests still pass). Optional: add a small `describe` block for `KolSettings` defaults (could also live in `kolScheduleService.test.ts`).

## Implementation Steps

1. Create `src/services/kolScheduleService.ts` with `runPrimePolling` and `runBatchCrawl`.
2. Refactor `kolDaemon.ts` to import those functions and remove the inline copies.
3. Create `src/tests/kolScheduleService.test.ts` with all the new test cases.
4. Run `npm run test`.
5. (Optional) Run `npm run test:watch` while iterating.

## Todo List
- [ ] `kolScheduleService.ts` created
- [ ] `kolDaemon.ts` refactored to use it
- [ ] `kolScheduleService.test.ts` with prime-window helper, settings defaults, runPrimePolling, runBatchCrawl, createBatchCrawlTasks tests
- [ ] Route validation tests (can live in existing `kolCrawlerIntegration.test.ts` or new file)
- [ ] All tests pass (`npm run test`)

## Success Criteria
- `npm run test` exits 0.
- All previously-passing tests still pass.
- New tests cover the prime-window helper, `createBatchCrawlTasks`, `runPrimePolling` (in/out of window, mutex), `runBatchCrawl` (mutex), and KolSettings defaults.

## Risk Assessment
- **Low risk**: new test file, no impact on production code beyond the `kolScheduleService` extraction.

## Next Steps
- Phase 6: docs.
