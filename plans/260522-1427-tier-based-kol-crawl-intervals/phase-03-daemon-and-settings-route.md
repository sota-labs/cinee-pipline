# Phase 03 — Daemon Cron Swap + Settings Route

## Overview

- **Priority:** High
- **Status:** Completed
- **Blocked by:** Phase 02
- **Description:** Two coordinated changes:
  1. `kolDaemon.ts` — remove `executeCrawl` and the `0 */4 * * *` cron; add `executeTierCrawl` and a `*/15 * * * *` cron. Keep `crawlAllKolsSequential` import available for manual recovery.
  2. `kolSettings.ts` route — expose `tier_crawl_intervals` in the GET `/` response and the PATCH `/` handler with per-tier minimum validation.

## Related Code Files

- **Modify:** `src/scripts/kolDaemon.ts`
- **Modify:** `src/routes/kolSettings.ts`

## Key Insights

### kolDaemon.ts

- `executeCrawl` is defined at lines 23–31. It wraps `crawlAllKolsSequential` with try/catch using `err: unknown` pattern — the new `executeTierCrawl` must follow the same pattern.
- The 4h cron is at line 101: `cron.schedule("0 */4 * * *", executeCrawl)`.
- The `crawlAllKolsSequential` import at line 16 stays — it is not scheduled but remains available for `--run-now` startup and manual recovery.
- The `RUN_NOW` block (lines 90–96) currently calls `executeCrawl()`. After the change it should call `executeTierCrawl()` instead, so a manual startup still triggers a crawl.

### kolSettings.ts route

- GET `/` response (lines 18–29) currently omits `tier_crawl_intervals`. Add it to the response object.
- PATCH `/` handler (lines 95–189): the `allowedTopLevel` array (lines 101–106) handles flat fields. `tier_crawl_intervals` is a nested object, so it needs its own block (same pattern as `afk`, `manual`, `safety`, `self_reply`).
- Validation minimums: S ≥ 5 min, A ≥ 30 min, B ≥ 60 min, C ≥ 60 min. Use `Math.max` clamping (same pattern as `PATCH /thresholds` at lines 283–297).
- The PATCH response (lines 174–184) should also include `tier_crawl_intervals`.

## Implementation Steps

### kolDaemon.ts

1. **Update the import at line 16** — add `crawlDueKols` alongside `crawlAllKolsSequential`:

```typescript
import { crawlAllKolsSequential, crawlDueKols } from "../services/kolCrawlerService.js";
```

2. **Replace `executeCrawl` function** (lines 23–31) with `executeTierCrawl`:

```typescript
async function executeTierCrawl() {
  log.info("[KOLDaemon] Tier crawl job starting…");
  try {
    const result = await crawlDueKols();
    log.info(`[KOLDaemon] Tier crawl done — spawned ${result.tasksCreated} tasks for: ${result.handles.join(", ")}`);
  } catch (err: unknown) {
    log.error(`[KOLDaemon] Tier crawl job crashed: ${(err as Error).message}`);
  }
}
```

3. **In the `RUN_NOW` block** (line 93), replace `await executeCrawl()` with `await executeTierCrawl()`.

4. **Replace the 4h cron line** (line 101):

```typescript
// Old (remove):
cron.schedule("0 */4 * * *", executeCrawl);

// New:
// Tier-based crawl every 15 minutes — only crawls KOLs whose per-tier interval has elapsed
cron.schedule("*/15 * * * *", executeTierCrawl);
```

### kolSettings.ts route

5. **In GET `/` response** (lines 18–29), add `tier_crawl_intervals` to the returned object after `safety`:

```typescript
tier_crawl_intervals: settings.tier_crawl_intervals,
```

6. **In PATCH `/` handler**, after the `safety` block (after line 153), add a new block for `tier_crawl_intervals`:

```typescript
// Update nested Tier Crawl Intervals
if (updates.tier_crawl_intervals) {
  const tci = updates.tier_crawl_intervals;
  if (tci.S !== undefined) {
    settings.tier_crawl_intervals.S = Math.max(5, tci.S);
  }
  if (tci.A !== undefined) {
    settings.tier_crawl_intervals.A = Math.max(30, tci.A);
  }
  if (tci.B !== undefined) {
    settings.tier_crawl_intervals.B = Math.max(60, tci.B);
  }
  if (tci.C !== undefined) {
    settings.tier_crawl_intervals.C = Math.max(60, tci.C);
  }
}
```

7. **In PATCH `/` response** (lines 174–184), add `tier_crawl_intervals` to the returned `data` object:

```typescript
tier_crawl_intervals: settings.tier_crawl_intervals,
```

## Todo

### kolDaemon.ts
- [x] Update import at line 16 to include `crawlDueKols`
- [x] Replace `executeCrawl` function (lines 23–31) with `executeTierCrawl`
- [x] Update `RUN_NOW` block (line 93): `executeCrawl()` → `executeTierCrawl()`
- [x] Replace 4h cron (line 101) with 15-min cron calling `executeTierCrawl`

### kolSettings.ts
- [x] Add `tier_crawl_intervals` to GET `/` response (after `safety` field, ~line 28)
- [x] Add `tier_crawl_intervals` update block to PATCH `/` handler (after `safety` block, ~line 153)
- [x] Add `tier_crawl_intervals` to PATCH `/` response (after `self_reply` field, ~line 183)

### Verification
- [x] Run `tsc --noEmit` to verify no compile errors
- [x] Confirm `crawlAllKolsSequential` is still importable (not removed, just unscheduled)

## Success Criteria

- `tsc --noEmit` passes with zero errors
- `kolDaemon.ts` has no reference to `executeCrawl` or `"0 */4 * * *"`
- `GET /api/kol-settings` response includes `tier_crawl_intervals`
- `PATCH /api/kol-settings` with `{ "tier_crawl_intervals": { "S": 3 } }` clamps S to 5 (minimum)
- `PATCH /api/kol-settings` with `{ "tier_crawl_intervals": { "A": 60 } }` sets A to 60 successfully
- Daemon logs show `[KOLDaemon] Tier crawl job starting…` every 15 minutes

## Risk Assessment

- **Low risk for daemon change.** Removing `executeCrawl` is safe — it is only referenced in the cron schedule and `RUN_NOW` block, both of which are updated in the same edit.
- **Low risk for route change.** The `tier_crawl_intervals` block follows the exact same pattern as the existing `safety` block. No existing fields are touched.
- **Operational note:** After deployment, the first 15-min tick will crawl all KOLs whose `last_crawled_at` is older than their tier interval (or null). On a fresh deployment this could be a large batch. This is expected and correct behavior.
