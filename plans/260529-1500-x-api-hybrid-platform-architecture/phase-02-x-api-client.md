---
phase: 02
title: X API Client
status: pending
priority: high
blockedBy: phase-01
---

# Phase 02 — X API Client

## Context Links

- Spec: `plans/260529-1500-x-api-hybrid-platform-architecture/spec.md`
- Plan: `plans/260529-1500-x-api-hybrid-platform-architecture/plan.md`
- Phase 01: `plans/260529-1500-x-api-hybrid-platform-architecture/phase-01-config-and-model.md`

## Overview

- Priority: high
- Status: pending (blocked by phase-01)
- Create `src/services/platforms/x/xApiClient.ts` — X API v2 HTTP client using native `fetch()`. Handles auth, rate limits, user ID resolution, and tweet fetching.

## Key Insights

- Node 18+ has native `fetch()` — no HTTP library needed
- App-only Bearer token is sufficient for all read operations (no OAuth 1.0a)
- `getUserIdByHandle()` checks `KolProfile.x_user_id` first — avoids repeated `/users/by/username` calls
- Rate limit headers: `x-ratelimit-remaining` and `x-ratelimit-reset` (Unix timestamp)
- On 429 or remaining=0: throw `XRateLimitError` — caller decides to skip cycle
- `since_id` param on timeline: X API returns tweets newer than that ID (exclusive)
- Must request explicit `tweet.fields` — API returns minimal fields by default

## Requirements

- `XRateLimitError` class with `retryAfter: Date` property
- `getUserIdByHandle(handle)` — checks DB cache, calls API if missing, saves result
- `getUserTweets(userId, sinceId?)` — returns `XApiTweet[]` with public_metrics
- `getTweetReplies(tweetId)` — search by `conversation_id`, returns reply tweets
- Rate limit tracking per endpoint (remaining + reset)
- 404 on user lookup → throw error that caller can detect to mark KOL inactive

## Architecture

```
xApiClient.ts
  XRateLimitError extends Error { retryAfter: Date }
  XUserNotFoundError extends Error { handle: string }

  RateLimitState { remaining: number; resetAt: Date }
  rateLimitMap: Map<string, RateLimitState>  // keyed by endpoint path

  function updateRateLimit(endpoint, headers): void
  function checkRateLimit(endpoint): void  // throws XRateLimitError if exhausted

  export async function getUserIdByHandle(handle: string): Promise<string>
  export async function getUserTweets(userId: string, sinceId?: string): Promise<XApiTweet[]>
  export async function getTweetReplies(tweetId: string): Promise<XApiTweet[]>

  // Types
  export interface XApiTweet { id, text, created_at, public_metrics, referenced_tweets?, attachments?, entities? }
  export interface XApiMedia { media_key, type, url? }
  export interface XApiUser { id, username }
  export interface XApiResponse<T> { data?: T; includes?: { media?: XApiMedia[]; users?: XApiUser[] }; meta?: { next_token?: string } }
```

## Related Code Files

- Create: `src/services/platforms/x/xApiClient.ts`
- Reads: `src/config/settings.ts` (xApiBearerToken)
- Reads/writes: `src/db/models/KolProfile.ts` (x_user_id field)

## Implementation Steps

1. Create directory `src/services/platforms/x/`.
2. Create `src/services/platforms/x/xApiClient.ts`.
3. Define `XRateLimitError` and `XUserNotFoundError` classes.
4. Define `XApiTweet`, `XApiMedia`, `XApiUser`, `XApiResponse` interfaces.
5. Implement `RateLimitState` map and `updateRateLimit` / `checkRateLimit` helpers.
6. Implement `apiFetch<T>(path, params)` private helper:
   - Builds URL: `https://api.twitter.com/2${path}?${params}`
   - Sets `Authorization: Bearer ${settings.xApiBearerToken}` header
   - Calls `updateRateLimit` on response headers
   - On 429: throws `XRateLimitError`
   - On 404: throws `XUserNotFoundError`
   - On other non-2xx: throws `Error` with status + body
7. Implement `getUserIdByHandle(handle)`:
   - Query `KolProfile.findOne({ handle })` for cached `x_user_id`
   - If found and non-null, return it
   - Call `GET /2/users/by/username/${handle}?user.fields=id`
   - Save result: `KolProfile.updateOne({ handle }, { x_user_id: data.id })`
   - Return `data.id`
8. Implement `getUserTweets(userId, sinceId?)`:
   - `checkRateLimit('/2/users/:id/tweets')`
   - Params: `tweet.fields=public_metrics,created_at,referenced_tweets,attachments,entities&expansions=attachments.media_keys&media.fields=url&max_results=20`
   - Add `since_id=${sinceId}` if provided
   - Return `{ tweets: response.data ?? [], includes: response.includes }`
9. Implement `getTweetReplies(tweetId)`:
   - `checkRateLimit('/2/tweets/search/recent')`
   - Params: `query=conversation_id:${tweetId}&tweet.fields=public_metrics,created_at,author_id&expansions=author_id&user.fields=username&max_results=20`
   - Return `{ tweets: response.data ?? [], includes: response.includes }`
10. Export all public functions and types.
11. Run `npm run build` to verify no TypeScript errors.

## Todo List

- [ ] Create `src/services/platforms/x/` directory
- [ ] Define `XRateLimitError` and `XUserNotFoundError`
- [ ] Define `XApiTweet`, `XApiMedia`, `XApiUser`, `XApiResponse` interfaces
- [ ] Implement rate limit state map + helpers
- [ ] Implement `apiFetch` private helper
- [ ] Implement `getUserIdByHandle` with DB cache
- [ ] Implement `getUserTweets` with sinceId support
- [ ] Implement `getTweetReplies` via conversation_id search
- [ ] Verify `npm run build` passes

## Success Criteria

- `getUserIdByHandle` returns cached ID without API call on second invocation
- `getUserTweets` includes `includes.media` in return for mapper to resolve URLs
- `XRateLimitError.retryAfter` is a valid `Date` parsed from `x-ratelimit-reset` header
- File stays under 150 lines; split to `xApiPaginator.ts` if it grows

## Risk Assessment

- `impression_count` may be absent on Basic tier — mapper handles missing metrics (maps to 0)
- `since_id` requires knowing the last tweet ID, not just a timestamp — Phase 4 handles derivation

## Security Considerations

- Bearer token from `settings.xApiBearerToken` only — never logged
- No user credentials stored or transmitted

## Next Steps

- Phase 03 imports `XApiTweet`, `XApiMedia`, `XApiUser` types from this file
- Phase 04 imports `getUserIdByHandle`, `getUserTweets`, `getTweetReplies`
