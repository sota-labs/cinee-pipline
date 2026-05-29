---
phase: 04
title: Crawler Integration
status: pending
priority: high
blockedBy: phase-03
---

# Phase 04 — Crawler Integration

## Context Links

- Spec: `plans/260529-1500-x-api-hybrid-platform-architecture/spec.md`
- Plan: `plans/260529-1500-x-api-hybrid-platform-architecture/plan.md`
- Phase 02: `plans/260529-1500-x-api-hybrid-platform-architecture/phase-02-x-api-client.md`
- Phase 03: `plans/260529-1500-x-api-hybrid-platform-architecture/phase-03-result-mapper.md`
- Crawler: `src/services/kolCrawlerService.ts`

## Overview

- Priority: high
- Status: pending (blocked by phase-03)
- Modify `kolCrawlerService.ts` to replace browser Task creation with direct X API calls in `crawlKol()`, `crawlDueKols()`, and `crawlAllKolsSequential()`. Keep `processCrawlResults()` call unchanged.

## Key Insights

- `crawlKol()` currently calls `createCrawlTask()` (single KOL, legacy) — replace with xApiClient calls
- `crawlDueKols()` and `crawlAllKolsSequential()` call `createBatchCrawlTask()` — replace with per-KOL API calls
- `processCrawlResults(kol._id, rawPosts)` signature is unchanged — just pass mapped posts
- `XRateLimitError`: log warn, skip that KOL, continue loop (don't abort entire batch)
- `XUserNotFoundError`: mark `kol.is_active = false`, save, continue
- `since_id` derivation: query `KolPost.findOne({ kol_id }, {}, { sort: { posted_at: -1 } })` to get most recent post ID from URL
- Comment crawl: replace `createCommentCrawlTask()` with `getTweetReplies()` + `processCommentCrawlResult()` inline
- `createBatchCrawlTask`, `createCrawlTask`, `createCommentCrawlTask`, and browser prompt builders become dead code — remove them
- Keep `processBatchCrawlResult()` and `processCommentCrawlResult()` exports — they may still be called by existing webhook routes for in-flight tasks

## Requirements

- `crawlKol()` fetches tweets via X API, maps to IRawPost[], calls `processCrawlResults()`
- `crawlDueKols()` iterates KOLs and calls `crawlKol()` per KOL (no batch task)
- `crawlAllKolsSequential()` same — iterate and call `crawlKol()` per KOL
- `XRateLimitError` caught per-KOL: log warn, push error result, continue
- `XUserNotFoundError` caught: deactivate KOL, continue
- Comment crawl inline: after saving posts, call `getTweetReplies()` for posts with comments > 10
- `last_crawled_at` updated after successful crawl (same as before)

## Architecture

```
crawlKol(kol, options):
  1. Resolve since: Redis cache → kol.last_crawled_at → getDefaultSinceDate()
  2. Derive sinceId from most recent KolPost for this KOL (optional)
  3. userId = await getUserIdByHandle(kol.handle)  // cached in KolProfile.x_user_id
  4. { tweets, includes } = await getUserTweets(userId, sinceId)
  5. rawPosts = tweets.map(t => mapTweetToPost(t, kol.handle, includes))
  6. { saved, posts } = await processCrawlResults(kol._id, rawPosts)
  7. Update last_crawled_at + Redis cache
  8. For posts with comments > 10: getTweetReplies(tweetId) → mapRepliesToComments → update post

crawlDueKols():
  - Same query logic as before (tier intervals)
  - For each kol: await crawlKol(kol) with XRateLimitError catch
  - Returns { tasksCreated: kolsCrawled, handles }

crawlAllKolsSequential():
  - Same round-robin query
  - For each kol: await crawlKol(kol) with error catch
```

## Related Code Files

- Modify: `src/services/kolCrawlerService.ts`
- Reads: `src/services/platforms/x/xApiClient.ts`
- Reads: `src/services/platforms/x/xResultMapper.ts`

## Implementation Steps

1. Add imports at top of `kolCrawlerService.ts`:
   ```typescript
   import { getUserIdByHandle, getUserTweets, getTweetReplies, XRateLimitError, XUserNotFoundError } from './platforms/x/xApiClient.js';
   import { mapTweetToPost, mapRepliesToComments } from './platforms/x/xResultMapper.js';
   ```
2. Rewrite `KolCrawlerService.crawlKol()`:
   - Keep since-date resolution logic (Redis cache → DB → default)
   - Add sinceId derivation: query `KolPost.findOne({ kol_id: kol._id }).sort({ posted_at: -1 })`, extract tweet ID from `post_url` (last path segment)
   - Replace `createCrawlTask()` call with `getUserIdByHandle` + `getUserTweets` + `mapTweetToPost`
   - Call `processCrawlResults(kol._id, rawPosts)` — unchanged
   - Update `last_crawled_at` + Redis cache — unchanged
   - After saving: for each saved post with `comments > 10` (max 5), call `getTweetReplies`, map to comments, update post inline
   - Catch `XRateLimitError`: log warn, return early with empty result
   - Catch `XUserNotFoundError`: set `kol.is_active = false`, save, return early
3. Rewrite `crawlDueKols()`:
   - Keep tier-interval query logic unchanged
   - Replace `createBatchCrawlTask()` loop with per-KOL `crawlKol()` calls
   - Catch `XRateLimitError` per KOL: log warn, push error result, continue
   - Return `{ tasksCreated: successCount, handles: crawledHandles }`
4. Rewrite `crawlAllKolsSequential()`:
   - Keep round-robin query logic unchanged
   - Replace `createBatchCrawlTask()` loop with per-KOL `crawlKol()` calls
   - Same error handling as crawlDueKols
5. Remove dead code: `createBatchCrawlTask`, `createCrawlTask`, `createCommentCrawlTask`, `buildBatchCrawlPrompt`, `buildSingleCrawlPrompt`, `COMMENT_CRAWL_PROMPT_TEMPLATE`, `IKolCrawlInfo` interface.
6. Keep: `processBatchCrawlResult`, `processCommentCrawlResult` (webhook handlers for in-flight tasks).
7. Run `npm run build` to verify no TypeScript errors.

## Todo List

- [ ] Add xApiClient and xResultMapper imports
- [ ] Rewrite `crawlKol()` with X API calls
- [ ] Add sinceId derivation from last KolPost
- [ ] Add inline comment crawl via getTweetReplies
- [ ] Add XRateLimitError and XUserNotFoundError handling in crawlKol
- [ ] Rewrite `crawlDueKols()` to call crawlKol per KOL
- [ ] Rewrite `crawlAllKolsSequential()` to call crawlKol per KOL
- [ ] Remove dead browser task creation code
- [ ] Verify `npm run build` passes

## Success Criteria

- `crawlKol()` saves posts without creating any Task record
- `XRateLimitError` causes skip (no crash), logged at warn level
- `XUserNotFoundError` deactivates KOL, logged at warn level
- `processCrawlResults()` called with same signature as before
- `processBatchCrawlResult()` and `processCommentCrawlResult()` still exported (webhook compat)

## Risk Assessment

- In-flight browser tasks: `processBatchCrawlResult` kept for webhook compatibility
- sinceId from post_url: URL format is `https://x.com/{handle}/status/{id}` — extract last segment
- Delay between KOLs: keep existing `delay(5000)` in `crawlAllKols()` to avoid rate limit bursts

## Security Considerations

- No new auth surface — uses same settings.xApiBearerToken from Phase 01
- KOL deactivation is a write operation — only triggered on confirmed 404 from X API

## Next Steps

- Phase 05 writes integration test targeting the rewritten `crawlKol()`
- Monitor first production crawl cycle for rate limit hits
