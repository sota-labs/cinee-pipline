# Spec: KOL Crawl Since-Timestamp Filtering

## Problem

`crawlAllKolsSequential` builds a batch prompt with only handle names. The browser agent crawls all visible posts on the profile page regardless of when they were posted. Redis cache stores `last_crawled_at` per handle but it is never passed to the browser-level script, causing redundant re-crawls and unnecessary load.

## User Stories

- As the system, I want each crawl to only fetch posts newer than the last crawl, so I don't repeatedly save duplicates.
- As the system, I want a max crawl window of 24h to prevent expensive historical crawls when a KOL hasn't been crawled in a long time or has never been crawled.

## Design

### Rule: `effectiveSince = max(cachedSince, now - 24h)`

Single rule covers all cases:
- KOL never crawled → `cachedSince = null` → `effectiveSince = now - 24h`
- KOL last crawled >24h ago → cap to `now - 24h`
- KOL last crawled recently → keep `cachedSince` (it's newer than `now - 24h`)

### Change 1 — `kolCrawlScript.ts`: Accept `sinceTimestamp` parameter

Convert `KOL_TWEET_SCRIPT` from IIFE to a function expression that `page.evaluate()` can call with an argument:

```js
// Before (IIFE, no filter):
(function() {
  ...
  return tweets.map(...).filter(p => p.content && p.post_url);
})()

// After (function expression, agent passes sinceTimestamp):
(function(sinceTimestamp) {
  const sinceDate = sinceTimestamp ? new Date(sinceTimestamp) : null;
  ...
  return tweets.map(...).filter(p =>
    p.content && p.post_url &&
    (!sinceDate || !p.posted_at || new Date(p.posted_at) > sinceDate)
  );
})
```

Agent calls: `page.evaluate(TWEET_SCRIPT_FN, sinceTimestamp)`

### Change 2 — `kolCrawlerService.ts`: Cap `since` + embed per-handle timestamp in prompt

In `crawlAllKolsSequential`, when building `kolInfos`:

```ts
const MAX_CRAWL_WINDOW_MS = 24 * 60 * 60 * 1000;
const oldestAllowed = new Date(Date.now() - MAX_CRAWL_WINDOW_MS);
const rawSince = cachedLastCrawled ?? kol.last_crawled_at ?? null;
const since = rawSince && rawSince > oldestAllowed ? rawSince : oldestAllowed;
```

### Change 3 — `BATCH_KOL_CRAWL_PROMPT_TEMPLATE`: Per-handle `since` in instructions

Replace:
```
Handles: {{handleList}}
```

With:
```
Handles:
{{handleList}}

For each handle above, before running TWEET_SCRIPT:
- Set sinceTimestamp to the ISO string shown
- Call: page.evaluate(TWEET_SCRIPT_FN, sinceTimestamp)
```

And `handleList` format changes from `@h1, @h2` to:
```
- @handle1 | sinceTimestamp: "2025-05-10T03:00:00.000Z"
- @handle2 | sinceTimestamp: "2025-05-09T15:30:00.000Z"
```

## Files to Change

| File | Change |
|------|--------|
| `src/utils/kolCrawlScript.ts` | Convert `KOL_TWEET_SCRIPT` IIFE → function expression with `sinceTimestamp` param + filter |
| `src/services/kolCrawlerService.ts` | Cap `since` with 24h max window; update `BATCH_KOL_CRAWL_PROMPT_TEMPLATE`; update `createBatchCrawlTask` to format per-handle list |

## Edge Cases

| Case | Result |
|------|--------|
| KOL never crawled | `effectiveSince = now - 24h` |
| `last_crawled_at` older than 24h | capped to `now - 24h` |
| `posted_at` missing on a tweet | script keeps the post (safe default) |
| Redis down | fallback to `kol.last_crawled_at` then cap applies |
| `since` in the future (clock skew) | `max()` rule → `now - 24h` wins, safe |

## Out of Scope

- Single-KOL `crawlKol()` path — already passes `since` to `createCrawlTask`, not used by the cron job
- Comment crawling — no timestamp filter needed (comments are fetched per post, not per time range)
- `KOL_COMMENT_SCRIPT` — no changes

## Success Criteria

- Each batch prompt contains per-handle `sinceTimestamp`
- Browser script skips posts older than `sinceTimestamp`
- A KOL never crawled before gets `now - 24h` as `since`
- A KOL with stale `last_crawled_at` (>24h) also gets `now - 24h`
- No change to Redis cache structure or TTL
