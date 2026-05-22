# Phase 02 — Implement `crawlDueKols()` in `kolCrawlerService.ts`

## Overview

- **Priority:** High (blocks phase 3)
- **Status:** Completed
- **Blocked by:** Phase 01
- **Description:** Add `crawlDueKols()` as a new exported function in `kolCrawlerService.ts`. It reads `tier_crawl_intervals` from settings, computes per-tier cutoff timestamps, queries only KOLs whose `last_crawled_at` is past their cutoff (or null), then spawns batch crawl tasks. `crawlAllKolsSequential` is left completely untouched.

## Related Code Files

- **Modify:** `src/services/kolCrawlerService.ts`
- **Read (no change):** `src/db/models/KolSettings.ts` (for `ITierCrawlIntervals` import)
- **Read (no change):** `src/db/models/KolProfile.ts` (for `tier` and `last_crawled_at` fields)

## Key Insights

- `createBatchCrawlTask(kols: IKolCrawlInfo[])` is defined at line 141 and is already the correct primitive to call — it creates one Task record per chunk.
- `IKolCrawlInfo` (line 131–135): `{ handle: string; since: string; limit: number }`.
- `ICrawlSpawnResult` (lines 619–622): `{ tasksCreated: number; handles: string[] }` — same return type as `crawlAllKolsSequential`.
- `MAX_CRAWL_WINDOW_MS` (line 24) and `getCachedLastCrawled` (line 26) are already available in the same file.
- `KolSettings` is already imported (line 6). `ITierCrawlIntervals` needs to be added to that import.
- The `$or` query with per-tier conditions is the cleanest MongoDB approach — avoids a JS-side filter loop over potentially large collections.
- Sort `{ tier: 1, last_crawled_at: 1 }` ensures S-tier KOLs are processed first, and within a tier the longest-waiting KOL goes first.

## Implementation Steps

1. **Update the `KolSettings` import** at line 6 to also import `ITierCrawlIntervals`:

```typescript
import { KolSettings, type ITierCrawlIntervals } from "../db/models/KolSettings.js";
```

2. **After `crawlAllKolsSequential` ends** (after line 687, before the `// ── Singleton Export` comment at line 689), insert the new function:

```typescript
/**
 * Crawl only KOLs whose per-tier interval has elapsed since last_crawled_at.
 * Called every 15 minutes by kolDaemon. Does NOT modify crawlAllKolsSequential.
 */
export async function crawlDueKols(): Promise<ICrawlSpawnResult> {
  const kolSettings = await KolSettings.getSettings();
  const intervals: ITierCrawlIntervals = kolSettings.tier_crawl_intervals;
  const minTrustScore = kolSettings.safety.min_kol_trust_score;

  const now = Date.now();
  const cutoffS = new Date(now - intervals.S * 60_000);
  const cutoffA = new Date(now - intervals.A * 60_000);
  const cutoffB = new Date(now - intervals.B * 60_000);
  const cutoffC = new Date(now - intervals.C * 60_000);

  const kols = await KolProfile.find({
    is_active: true,
    reputation_score: { $gte: minTrustScore },
    $or: [
      { tier: "S", $or: [{ last_crawled_at: null }, { last_crawled_at: { $lte: cutoffS } }] },
      { tier: "A", $or: [{ last_crawled_at: null }, { last_crawled_at: { $lte: cutoffA } }] },
      { tier: "B", $or: [{ last_crawled_at: null }, { last_crawled_at: { $lte: cutoffB } }] },
      { tier: "C", $or: [{ last_crawled_at: null }, { last_crawled_at: { $lte: cutoffC } }] },
    ],
  }).sort({ tier: 1, last_crawled_at: 1 });

  if (kols.length === 0) {
    log.info("[KolCrawler] crawlDueKols — no KOLs due for crawl");
    return { tasksCreated: 0, handles: [] };
  }

  log.info(`[KolCrawler] crawlDueKols — ${kols.length} KOLs due`);

  const kolInfos: IKolCrawlInfo[] = [];
  for (const kol of kols) {
    const cachedLastCrawled = await getCachedLastCrawled(kol.handle);
    const oldestAllowed = new Date(now - MAX_CRAWL_WINDOW_MS);
    const rawSince = cachedLastCrawled ?? kol.last_crawled_at ?? null;
    const since =
      rawSince && rawSince > oldestAllowed && rawSince <= new Date(now)
        ? rawSince
        : oldestAllowed;
    kolInfos.push({
      handle: kol.handle,
      since: since.toISOString(),
      limit: kolSettings.max_posts_per_crawl,
    });
  }

  const chunkSize = kolSettings.crawl_handles_per_task;
  const allHandles: string[] = [];
  let tasksCreated = 0;

  for (let i = 0; i < kolInfos.length; i += chunkSize) {
    const chunk = kolInfos.slice(i, i + chunkSize);
    await createBatchCrawlTask(chunk);
    allHandles.push(...chunk.map((k) => k.handle));
    tasksCreated++;
  }

  log.info(`[KolCrawler] crawlDueKols — spawned ${tasksCreated} tasks for: ${allHandles.join(", ")}`);
  return { tasksCreated, handles: allHandles };
}
```

## Todo

- [x] Update `KolSettings` import at line 6 to include `ITierCrawlIntervals`
- [x] Insert `crawlDueKols()` function after line 687 (before `// ── Singleton Export`)
- [x] Run `tsc --noEmit` to verify no compile errors

## Success Criteria

- `tsc --noEmit` passes with zero errors
- Function is exported and callable from `kolDaemon.ts`
- When all KOLs were crawled recently, returns `{ tasksCreated: 0, handles: [] }`
- When S-tier KOLs are overdue, they appear first in the spawned task handles
- `crawlAllKolsSequential` is byte-for-byte unchanged

## Risk Assessment

- **Low-medium risk.** The MongoDB `$or` with nested `$or` per tier is valid but slightly complex. Verify the query plan is acceptable (index on `{ is_active, reputation_score, tier, last_crawled_at }` would be ideal but is not required for correctness).
- If `KolProfile` does not have a `tier` field, the query returns 0 results silently — not a crash, but a silent no-op. Confirm `tier` field exists on the model before deploying.
- `getCachedLastCrawled` is `async` — the `for` loop is sequential by design (same pattern as `crawlAllKolsSequential`).
