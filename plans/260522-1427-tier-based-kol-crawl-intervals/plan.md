# Plan: Tier-Based Dynamic KOL Crawl Intervals

**Created:** 2026-05-22  
**Status:** Completed

## Problem

The current 4h cron runs round-robin across all KOLs. Tier S/A KOLs can wait up to 24h before their posts are crawled. The fix replaces the 4h cron with a 15-min cron that queries only KOLs whose per-tier interval has elapsed.

## Solution Summary

1. Add `ITierCrawlIntervals` interface + `tier_crawl_intervals` field to `KolSettings`
2. Implement `crawlDueKols()` in `kolCrawlerService.ts` — queries KOLs by tier cutoff, spawns batch tasks
3. Replace `executeCrawl` / 4h cron in `kolDaemon.ts` with `executeTierCrawl` / 15-min cron; expose `tier_crawl_intervals` in the PATCH route

## Phases

| # | Phase | File(s) | Status |
|---|-------|---------|--------|
| 1 | KolSettings schema — add `ITierCrawlIntervals` + `tier_crawl_intervals` | `src/db/models/KolSettings.ts` | Completed |
| 2 | `crawlDueKols()` function | `src/services/kolCrawlerService.ts` | Completed |
| 3 | Daemon cron swap + settings route | `src/scripts/kolDaemon.ts`, `src/routes/kolSettings.ts` | Completed |

## Key Dependencies

- Phase 2 depends on Phase 1 (needs `tier_crawl_intervals` from settings)
- Phase 3 depends on Phase 2 (imports `crawlDueKols`)
- `KolProfile` model must have `tier` field (`"S" | "A" | "B" | "C"`) and `last_crawled_at: Date | null`

## Phase Files

- [phase-01-kol-settings-schema.md](./phase-01-kol-settings-schema.md)
- [phase-02-crawl-due-kols-function.md](./phase-02-crawl-due-kols-function.md)
- [phase-03-daemon-and-settings-route.md](./phase-03-daemon-and-settings-route.md)
