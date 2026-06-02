# Phase 3 — `kolDaemon.ts` Schedule Refactor

## Context Links
- Current daemon: `src/scripts/kolDaemon.ts:106-138`
- Phase 2 new function: `createBatchCrawlTasks`
- Phase 1 helper: `isWithinPrimeWindow`
- Settings loader: `KolSettings.getSettings()`

## Overview
- **Priority**: P1
- **Status**: pending
- **Description**: Replace the single `0 */2 * * * executeTierCrawl` job with four new jobs: a 15-minute prime poll, a 2h S+A batch, a 3h B batch, and a 4h C batch. Keep all other schedules (`executeAnalyze`, `executeAFKReplies`, `executeSelfReplies`, `executeAutoReject`, `executeSessionCleanup`) unchanged.

## Requirements

### Functional
1. **Prime poll** (every 15 min): `executePrimePolling()`
   - Loads `KolSettings`.
   - If `!isWithinPrimeWindow(settings.prime_window, new Date())` → log debug, return.
   - Else: query Tier S KOLs due (same predicate as `crawlDueKols` but tier-locked to `"S"`), call `kolCrawlerService.crawlKol(kol, ...)` for each with `pLimit(crawl_concurrency)`.
   - Reuses the existing `XRateLimitError` handling: short-circuit on rate limit.
2. **S+A batch** (every 2h): `executeBatchCrawl(["S", "A"])`
   - Calls `createBatchCrawlTasks(["S", "A"])`.
   - Tier S is off-prime here (the only way this fires outside the prime window), Tier A is always due.
3. **B batch** (every 3h at `:00`): `executeBatchCrawl(["B"])`.
4. **C batch** (every 4h at `:00`): `executeBatchCrawl(["C"])`.
5. Replace the single `isTierCrawling` mutex with **two independent mutexes**:
   - `isPrimePolling` — guards `executePrimePolling`.
   - `isBatchCrawling` — guards all three `executeBatchCrawl` calls (they share the same downstream path and shouldn't overlap).
6. **Delete** the old `executeTierCrawl` function and the `import { crawlDueKols }` import (will be unused after Phase 4).

### Non-functional
- Cron strings must use server-local hours (same assumption as `prime_window`).
- All four jobs must coexist on the same daemon process (no need for additional daemons).
- Backwards-compat: the existing `npm run kol:daemon` script and `--run-now` flag continue to work; `--run-now` triggers the prime poll + analyze + AFK + self-reply (skipping the batch crons since they don't make sense on a cold start).

## Architecture

### Schedule table (server-local time)

| Cron | Function | Tiers | When |
|------|----------|-------|------|
| `*/15 * * * *` | `executePrimePolling` | S | only if within `prime_window` |
| `0 */2 * * *` | `executeBatchCrawl(["S","A"])` | S (off-prime), A | every 2h |
| `0 */3 * * *` | `executeBatchCrawl(["B"])` | B | every 3h at :00 |
| `0 */4 * * *` | `executeBatchCrawl(["C"])` | C | every 4h at :00 |
| `*/10 * * * *` | `executeAnalyze` | — | unchanged |
| `*/10 * * * *` | `executeAFKReplies` | — | unchanged |
| `*/2 * * * *` | `executeSelfReplies` | — | unchanged |
| `*/10 * * * *` | `executeAutoReject` | — | unchanged |
| `0 */2 * * *` | `executeSessionCleanup` | — | unchanged |

### Prime-window cross-check
The 15-min cron can fire 4 times in a 1h prime window. To avoid creating a single 4h prime window (the schema allows it), we validate `end_hour - start_hour <= 12` in the route PATCH. Within the window, the X API poll happens 16 times a day on Tier S. Each Tier S call: 1 GET /users/:id/tweets. With ~25 Tier S KOLs and concurrency 5, we get 5 calls every 15 min = 20 calls/hr × 4h = 80 calls/day on Tier S. Comfortably under Pay-Per-Use limits.

### `isPrimePolling` / `isBatchCrawling` mutex
- `executePrimePolling` early-returns with a warn if `isPrimePolling` is true.
- `executeBatchCrawl` early-returns with a warn if `isBatchCrawling` is true (covers the case where a 2h S+A job and a 3h B job happen to land in the same minute).
- Both mutexes are local `let` booleans (in-process only). Multi-instance deployments would need a Redis lock — out of scope.

## Related Code Files

### Modify
- `src/scripts/kolDaemon.ts`:
  - Remove `import { crawlDueKols }`.
  - Add `import { createBatchCrawlTasks, kolCrawlerService } from "../services/kolCrawlerService.js"`.
  - Add `import { isWithinPrimeWindow } from "../db/models/KolSettings.js"` (or a util).
  - Replace `executeTierCrawl` with `executePrimePolling` and `executeBatchCrawl`.
  - Replace `isTierCrawling` with `isPrimePolling` + `isBatchCrawling`.
  - Replace the single cron `0 */2 * * *` with the four new ones.
  - Update `RUN_NOW` to call `executePrimePolling()` instead of `executeTierCrawl()`.

## Implementation Steps

1. Edit `kolDaemon.ts` imports.
2. Add `executePrimePolling`:
   ```typescript
   async function executePrimePolling() {
     if (isPrimePolling) { log.warn("[KOLDaemon] Prime poll in progress, skipping"); return; }
     isPrimePolling = true;
     try {
       const settings = await KolSettings.getSettings();
       if (!isWithinPrimeWindow(settings.prime_window, new Date())) {
         log.debug("[KOLDaemon] Outside prime window, skipping Tier S poll");
         return;
       }
       // ... same KOL query as crawlDueKols but tier-locked to "S", then call kolCrawlerService.crawlKol per KOL
     } finally { isPrimePolling = false; }
   }
   ```
3. Add `executeBatchCrawl(tiers)`:
   ```typescript
   async function executeBatchCrawl(tiers: Array<"S" | "A" | "B" | "C">) {
     if (isBatchCrawling) { log.warn("[KOLDaemon] Batch crawl in progress, skipping"); return; }
     isBatchCrawling = true;
     try {
       const result = await createBatchCrawlTasks(tiers);
       log.info(`[KOLDaemon] Batch crawl [${tiers.join(",")}] — created ${result.tasksCreated} tasks`);
     } catch (err) { log.error(...); } finally { isBatchCrawling = false; }
   }
   ```
4. Replace cron registrations.
5. Update `--run-now` block.

## Todo List
- [ ] `executePrimePolling` implemented
- [ ] `executeBatchCrawl` implemented
- [ ] Mutex split into `isPrimePolling` + `isBatchCrawling`
- [ ] Four cron registrations added
- [ ] `--run-now` updated
- [ ] `crawlDueKols` import removed
- [ ] typecheck passes

## Success Criteria
- `npm run kol:daemon` boots, schedules all 9 jobs, exits gracefully on SIGTERM.
- `node-cron` parses all cron strings (manually verify with `cron.validate("0 */3 * * *")`).
- Logs show "Outside prime window, skipping" when run outside configured hours.
- Logs show "Prime poll" when run inside.

## Risk Assessment
- **Low risk**: cron strings are well-tested patterns.
- **Mid risk**: if both `executeBatchCrawl` calls land at the same minute (e.g. 00:00, 06:00, 12:00, 18:00), the second one will short-circuit. Acceptable — the next 2h/3h cycle will pick up the work. Document.

## Next Steps
- Phase 4: delete `crawlDueKols` and related stream code.
