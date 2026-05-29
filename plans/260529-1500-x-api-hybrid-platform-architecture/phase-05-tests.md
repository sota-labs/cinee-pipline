---
phase: 05
title: Tests
status: pending
priority: medium
blockedBy: phase-04
---

# Phase 05 — Tests

## Context Links

- Spec: `plans/260529-1500-x-api-hybrid-platform-architecture/spec.md`
- Plan: `plans/260529-1500-x-api-hybrid-platform-architecture/plan.md`
- Existing test pattern: `src/tests/kolCrawlResultParser.test.ts`
- Vitest config: `vitest.config.ts`

## Overview

- Priority: medium
- Status: pending (blocked by phase-04)
- Write unit tests for `xResultMapper.ts` (fixture-based), unit tests for `xApiClient.ts` rate limit logic (mock fetch), and an integration test for `crawlKol()` with mocked X API.

## Key Insights

- Vitest is already configured — tests in `src/**/*.test.ts`, run with `npm test`
- Existing tests use `describe/it/expect` from vitest — follow same pattern
- No MongoDB in unit tests — mock `KolProfile.findOne` and `KolProfile.updateOne` with `vi.fn()`
- Mock `fetch` globally with `vi.stubGlobal('fetch', mockFetch)` for xApiClient tests
- Integration test for `crawlKol()` needs to mock: `getUserIdByHandle`, `getUserTweets`, `processCrawlResults`
- Fixture data: define inline in test file — no separate fixture files needed (KISS)

## Requirements

- `xResultMapper.test.ts`: covers normal tweet, retweet, quote tweet, missing metrics, media URL resolution
- `xApiClient.test.ts`: covers rate limit header parsing, XRateLimitError on 429, XRateLimitError when remaining=0, XUserNotFoundError on 404
- `kolCrawlerIntegration.test.ts`: crawlKol() saves posts, handles XRateLimitError (skip), handles XUserNotFoundError (deactivate)

## Architecture

```
src/tests/
  xResultMapper.test.ts       — pure unit, no mocks needed (pure functions)
  xApiClient.test.ts          — vi.stubGlobal('fetch', ...) for HTTP mocking
  kolCrawlerIntegration.test.ts — vi.mock for xApiClient + processCrawlResults
```

## Related Code Files

- Create: `src/tests/xResultMapper.test.ts`
- Create: `src/tests/xApiClient.test.ts`
- Create: `src/tests/kolCrawlerIntegration.test.ts`
- Reads: `src/services/platforms/x/xResultMapper.ts`
- Reads: `src/services/platforms/x/xApiClient.ts`
- Reads: `src/services/kolCrawlerService.ts`

## Implementation Steps

1. Create `src/tests/xResultMapper.test.ts`:
   - Define fixture `XApiTweet` objects (normal, retweet, quote, with media, missing metrics)
   - Test `mapTweetToPost`: verify all IRawPost fields for each fixture
   - Test `is_retweet: true` when referenced_tweets has type `'retweeted'`
   - Test `is_quote: true` when referenced_tweets has type `'quoted'`
   - Test `media_urls` resolved from `includes.media`
   - Test missing `public_metrics` → all metrics default to 0
   - Test `mapRepliesToComments`: verify author_handle resolved from includes.users

2. Create `src/tests/xApiClient.test.ts`:
   - Use `vi.stubGlobal('fetch', mockFetch)` in `beforeEach`, restore in `afterEach`
   - Test `getUserIdByHandle`: mock KolProfile.findOne returning null → API called → result saved
   - Test `getUserIdByHandle`: mock KolProfile.findOne returning cached x_user_id → API NOT called
   - Test rate limit: mock response with `x-ratelimit-remaining: 0` → next call throws `XRateLimitError`
   - Test 429 response → throws `XRateLimitError` with valid `retryAfter` date
   - Test 404 on user lookup → throws `XUserNotFoundError`

3. Create `src/tests/kolCrawlerIntegration.test.ts`:
   - `vi.mock('../services/platforms/x/xApiClient.js', ...)` — mock getUserIdByHandle, getUserTweets
   - `vi.mock('../services/kolCrawlerService.js', { processCrawlResults: vi.fn() })` — or spy
   - Test: crawlKol() with valid tweets → processCrawlResults called with mapped IRawPost[]
   - Test: crawlKol() throws XRateLimitError → returns early, processCrawlResults NOT called
   - Test: crawlKol() throws XUserNotFoundError → kol.is_active set to false

4. Run `npm test` — all tests must pass.

## Todo List

- [ ] Create `src/tests/xResultMapper.test.ts` with fixture-based tests
- [ ] Test normal tweet mapping (all fields)
- [ ] Test retweet detection
- [ ] Test quote tweet detection + quoted_post_url
- [ ] Test media URL resolution from includes
- [ ] Test missing public_metrics defaults to 0
- [ ] Test mapRepliesToComments author_handle resolution
- [ ] Create `src/tests/xApiClient.test.ts` with mocked fetch
- [ ] Test getUserIdByHandle cache hit (no API call)
- [ ] Test getUserIdByHandle cache miss (API called, result saved)
- [ ] Test XRateLimitError on 429
- [ ] Test XRateLimitError when remaining=0
- [ ] Test XUserNotFoundError on 404
- [ ] Create `src/tests/kolCrawlerIntegration.test.ts`
- [ ] Test crawlKol happy path
- [ ] Test crawlKol XRateLimitError skip
- [ ] Test crawlKol XUserNotFoundError deactivation
- [ ] Run `npm test` — all pass

## Success Criteria

- All new tests pass: `npm test` exits 0
- No existing tests broken
- xResultMapper tests cover: normal, retweet, quote, media, missing metrics
- xApiClient tests cover: cache hit/miss, 429, remaining=0, 404
- Integration test verifies processCrawlResults called with correct IRawPost shape

## Risk Assessment

- `vi.mock` module path must match exact import path used in source (`.js` extension)
- KolProfile mock: need to mock both `findOne` (for cache check) and `updateOne` (for save)
- Settings mock: `settings.xApiBearerToken` must be defined in test env — use `vi.mock('../config/settings.js', ...)`

## Security Considerations

- Test fixtures use fake bearer tokens — no real credentials in test files
- No real HTTP calls in tests — all mocked

## Next Steps

- Deploy and monitor first production crawl cycle
- Watch for `impression_count` availability on X API Basic tier
- If file size grows: split xApiClient into xApiClient + xApiPaginator
