# Spec: X API Hybrid + Multi-Platform Open Architecture

**Date:** 2026-05-29  
**Status:** Draft  
**Scope:** Migrate KOL post crawling to X API v2; keep post/reply on browser; structure code for future platform expansion

---

## Problem Statement

Current system routes all X operations through OpenClaw browser automation. This creates:
- Fragility: DOM selectors break when X updates UI
- Session conflicts: browser sessions compete for the same logged-in account
- Latency: browser startup + page load for every crawl cycle
- Scalability ceiling: one browser session per handle_group

**Goal:** Replace KOL post crawling with X API v2 (stable, fast, no session conflicts). Keep post/reply on browser (intentional — avoids X API write quota costs and keeps human-like behavior). Structure the new code so adding Facebook/Threads later requires no refactoring of existing paths.

---

## User Stories

- As the system, I want to crawl KOL posts via X API so crawls are reliable and don't consume browser sessions
- As the system, I want post/reply to stay on browser so write behavior remains human-like and doesn't consume API write quota
- As a developer, I want to add a new platform (Facebook, Threads) by adding files under `src/services/platforms/`, not by modifying existing X code

---

## What Changes vs What Stays the Same

### Stays the same
- Task model and cinee-worker polling protocol
- Post/reply execution (browser automation, unchanged prompts)
- All downstream processing: analysis, suggestions, AFK/manual mode, Telegram approval
- Self-reply flow (entirely browser-based, untouched)
- Rate limiting for replies
- Priority/handle_group system

### Changes
- `kolCrawlerService.ts`: crawl path calls X API instead of creating a browser Task
- `KolProfile` model: add `x_user_id` field for caching resolved user IDs
- `settings.ts`: add X API credentials config
- New directory: `src/services/platforms/x/` with API client + result mapper

---

## Architecture

### Current flow (crawl)
```
kolCrawlerService → create Task (browser prompt) → cinee-worker → OpenClaw → DOM scrape → webhook result
```

### New flow (crawl)
```
kolCrawlerService → xApiClient.getUserTweets() → map to KolPost format → save directly
```

No Task record needed for crawl. The Task queue was designed for OpenClaw worker delegation — direct API calls bypass it cleanly.

### Post/reply flow (unchanged)
```
replyEngineService / selfReplyService → create Task (browser prompt) → cinee-worker → OpenClaw → post reply
```

### Directory structure (new files only)
```
src/services/platforms/
└── x/
    ├── xApiClient.ts       # X API v2 HTTP calls, auth, rate limit tracking
    └── xResultMapper.ts    # Maps API response → internal KolPost/comment format
```

No `index.ts` barrel or interface yet — added when a second platform is implemented (YAGNI).

---

## Component Design

### `xApiClient.ts`

Responsibilities:
- Bearer token auth (app-only, sufficient for all read operations)
- `getUserIdByHandle(handle)` — resolves handle → numeric user ID, cached in KolProfile
- `getUserTweets(userId, sinceId?)` — paginated timeline fetch, returns raw API objects
- `getTweetReplies(tweetId)` — search recent tweets in conversation (for comment crawl phase 2)
- Internal rate limit tracking: sliding window counter per endpoint, throws `XRateLimitError` when exceeded

Auth: App-only Bearer token via `Authorization: Bearer <token>` header. No user OAuth needed for reads.

Rate limit strategy: track remaining/reset headers from X API responses. On `429`, throw `XRateLimitError` with `retryAfter` — caller decides whether to skip or queue a retry.

### `xResultMapper.ts`

Maps X API v2 tweet object → internal post format (same shape as browser scrape result):
```typescript
mapTweetToPost(tweet: XApiTweet, handle: string): CrawledPost
mapRepliesToComments(tweets: XApiTweet[]): CrawledComment[]
```

Key mappings:
- `tweet.public_metrics.like_count` → `likes`
- `tweet.public_metrics.reply_count` → `comments`  
- `tweet.public_metrics.retweet_count` → `retweets`
- `tweet.public_metrics.impression_count` → `views` (requires `tweet.fields=public_metrics`)
- `tweet.referenced_tweets[].type === 'retweeted'` → `is_retweet: true`
- `tweet.attachments.media_keys` → resolve via `includes.media[]` → `media_urls`

### `kolCrawlerService.ts` changes

Replace `createBatchCrawlTask()` / `createSingleCrawlTask()` with direct API calls:

```typescript
// Before: creates Task → browser
async crawlKol(kol: KolProfile, since?: Date): Promise<void> {
  await createBatchCrawlTask([kol])  // → OpenClaw
}

// After: calls API directly
async crawlKol(kol: KolProfile, since?: Date): Promise<void> {
  try {
    const userId = await xApiClient.getUserIdByHandle(kol.handle)  // cached
    const tweets = await xApiClient.getUserTweets(userId, since)
    const posts = tweets.map(t => xResultMapper.mapTweetToPost(t, kol.handle))
    await processCrawlResults(kol, posts)  // existing processing logic, unchanged
  } catch (err) {
    if (err instanceof XRateLimitError) {
      log.warn(`X API rate limit hit for ${kol.handle}, skipping this cycle`)
      return
    }
    throw err
  }
}
```

Comment crawl (phase 2) similarly replaces browser task with `getTweetReplies()`.

### `KolProfile` model change

Add one field:
```typescript
x_user_id?: string  // cached numeric X user ID, resolved on first crawl
```

`getUserIdByHandle()` checks this field first, calls `GET /2/users/by/username/:handle` only if missing, then saves result.

### `settings.ts` / env vars

Add:
```
X_API_BEARER_TOKEN=...   # App-only Bearer token for read operations
```

No OAuth 1.0a or PKCE needed — all crawl operations are app-only reads.

---

## Error Handling

| Error | Behavior |
|-------|----------|
| `XRateLimitError` | Log warning, skip this KOL for current cycle. Next cycle will retry. |
| Network timeout | Log error, skip. Existing retry logic in crawl daemon handles it. |
| Handle not found (404) | Log warning, mark KolProfile as `inactive`. |
| API returns 0 tweets | Normal — KOL hasn't posted. No error. |
| X API credentials missing | Throw at startup (fail fast in `settings.ts` validation). |

No fallback to browser for crawl — if API fails, skip the cycle. Browser fallback adds complexity without meaningful benefit (rate limits reset in 15 min, next crawl cycle handles it).

---

## Multi-Platform Open Architecture

No interface or abstract class yet. The convention is:

- Each platform lives in `src/services/platforms/{platform}/`
- Each platform exposes functions matching the operations it supports
- `kolCrawlerService.ts` imports from `platforms/x/` directly
- When Facebook is added: create `platforms/facebook/`, update the relevant service to import from it

The directory structure signals intent without imposing premature abstraction. When 2+ platforms share the same operation (e.g., both X and Threads support "get user posts"), that's the right time to extract a shared interface.

**Future platforms:**
- Facebook: browser-only for crawl (Graph API requires Meta app review for public content). Post/reply via Graph API for managed pages.
- Threads: API for post/reply, browser for crawl (no public timeline endpoint).

---

## Testing Strategy

- Unit test `xResultMapper.ts` with fixture API responses — verify field mappings, edge cases (retweet, quote tweet, missing metrics)
- Unit test `xApiClient.ts` rate limit tracking with mocked HTTP responses
- Integration test: mock X API, run `crawlKol()`, verify `KolPost` records saved correctly
- Existing reply/post tests: unchanged (browser path untouched)

---

## Implementation Considerations

1. **X user ID resolution is a one-time cost** — cache in `KolProfile.x_user_id`. Don't call `/users/by/username` on every crawl.
2. **`sinceId` pagination** — X API supports `since_id` param to fetch only new tweets. Use `KolProfile.last_crawled_at` to derive the appropriate `since_id` from the last known post.
3. **Media URLs from API** — X API returns `media_key` references, not direct URLs. Must request `expansions=attachments.media_keys&media.fields=url` and resolve from `includes.media`.
4. **Tweet fields** — Must explicitly request `tweet.fields=public_metrics,created_at,referenced_tweets,attachments,entities` — API returns minimal fields by default.
5. **File size** — `xApiClient.ts` should stay under 150 lines. If it grows, split pagination logic into `xApiPaginator.ts`.

---

## Success Criteria

- KOL post crawl works without browser session or OpenClaw task
- Post/reply behavior unchanged (same prompts, same Task flow)
- Adding a second platform requires only new files under `src/services/platforms/`, zero changes to X code
- `XRateLimitError` is handled gracefully — no crash, next cycle retries
- `KolProfile.x_user_id` populated after first crawl, not re-fetched on subsequent crawls

---

## Risks

| Risk | Mitigation |
|------|------------|
| X API Basic tier cost ($200/mo) | Confirmed acceptable by user |
| X changes API response shape | `xResultMapper.ts` isolates the mapping — one file to update |
| Rate limits hit during high-tier crawl bursts | Sliding window tracking + skip-cycle behavior |
| `impression_count` not available on Basic tier | Map to `0` if missing, log once at startup |

---

## Next Steps

1. Provision X API Basic tier app, get Bearer token
2. Implement `xApiClient.ts` + `xResultMapper.ts`
3. Modify `kolCrawlerService.ts` crawl path
4. Add `x_user_id` to `KolProfile` model + migration
5. Update `settings.ts` + `.env.example`
6. Write unit tests for mapper and client
7. Deploy and monitor first crawl cycle
