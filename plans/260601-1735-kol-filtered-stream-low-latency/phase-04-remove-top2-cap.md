# Phase 04 — Remove Top-2 Post Cap in Crawler

**Spec:** [spec.md](./spec.md) | **Plan:** [plan.md](./plan.md)

## Overview

- **Priority:** P2
- **Status:** Completed
- **Effort:** 0.5h

Remove the artificial limit that keeps only the top 2 posts per crawl cycle. All posts passing `shouldDropAtCrawl()` should be saved and processed.

## Key Insights

- The cap exists in two places: `crawlKol()` (polling path) and `processBatchCrawlResult()` (OpenClaw batch path)
- Removing it means more posts enter the analyze/reply pipeline — confirm OpenClaw queue can handle the volume
- Deduplication via upsert on `post_url` is already in place — safe to remove cap

## Related Code Files

- **Modify:** `src/services/kolCrawlerService.ts`

## Implementation Steps

1. In `crawlKol()`: find the `.slice(0, 2)` or `keepTopN(2)` call after engagement score sorting — remove it. Keep the sort by engagement score (useful for prioritization, just don't truncate).

2. In `processBatchCrawlResult()`: find the equivalent top-N filter — remove it.

3. Verify `processCrawlResults()` is unchanged — it already handles arrays of any size.

## Todo List

- [x] Remove top-2 cap in `crawlKol()`
- [x] Remove top-2 cap in `processBatchCrawlResult()`
- [x] Run `npm run build` — confirm no compile errors
- [x] Run existing crawler tests — confirm no regressions

## Success Criteria

- All posts passing `shouldDropAtCrawl()` are saved to DB
- Existing tests pass
- No change to engagement score sorting logic
