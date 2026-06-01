# Phase 01 — Add Stream Methods to xApiClient

**Spec:** [spec.md](./spec.md) | **Plan:** [plan.md](./plan.md)

## Overview

- **Priority:** P1
- **Status:** Completed
- **Effort:** 1.5h

Add X Filtered Stream API methods to the existing `xApiClient.ts`. No new dependencies — uses native `fetch()` with `response.body` ReadableStream (Node.js v22).

## Key Insights

- `xApiClient.ts` already uses native `fetch()` with Bearer token — same pattern applies to stream
- Stream endpoint: `GET https://api.twitter.com/2/tweets/search/stream` — returns SSE-style newline-delimited JSON
- Rules endpoint: `POST/GET/DELETE https://api.twitter.com/2/tweets/search/stream/rules`
- `response.body` is a `ReadableStream<Uint8Array>` in Node.js v22 — use `TextDecoder` to decode chunks
- Heartbeat: X sends empty lines every 20s to keep connection alive — must handle without crashing
- Rate limits: Rules endpoint has its own rate limit headers — reuse existing `checkRateLimit()` / `updateRateLimit()` pattern

## Requirements

- `connectFilteredStream()` — opens persistent GET connection, streams chunks to callback, returns disconnect function
- `getStreamRules()` — GET current active rules
- `addStreamRules()` — POST new rules (idempotent tag-based)
- `deleteStreamRules()` — DELETE rules by ID
- All methods follow existing error class pattern (`XRateLimitError`)
- File must stay under 200 lines — extract stream types to a separate types file if needed

## Related Code Files

- **Modify:** `src/services/platforms/x/xApiClient.ts`
- **Create (if needed):** `src/services/platforms/x/xStreamTypes.ts` — stream-specific interfaces

## Implementation Steps

1. Add stream-specific interfaces at top of file (or in `xStreamTypes.ts` if file exceeds 200 lines):
   ```typescript
   export interface IStreamRule {
     id: string;
     value: string;
     tag?: string;
   }
   export interface IStreamRuleAdd {
     value: string;
     tag?: string;
   }
   ```

2. Add `getStreamRules()`:
   ```typescript
   async function getStreamRules(): Promise<IStreamRule[]> {
     const res = await fetch('https://api.twitter.com/2/tweets/search/stream/rules', {
       headers: { Authorization: `Bearer ${settings.twitterBearerToken}` }
     });
     if (!res.ok) throw new Error(`Stream rules fetch failed: ${res.status}`);
     const data = await res.json() as { data?: IStreamRule[] };
     return data.data ?? [];
   }
   ```

3. Add `addStreamRules(rules: IStreamRuleAdd[])`:
   - POST to `/2/tweets/search/stream/rules` with `{ add: rules }`
   - Return created rules with IDs
   - Handle 429 with `XRateLimitError`

4. Add `deleteStreamRules(ids: string[])`:
   - POST to `/2/tweets/search/stream/rules` with `{ delete: { ids } }`
   - No-op if ids is empty

5. Add `connectFilteredStream(onData, onError)`:
   ```typescript
   async function connectFilteredStream(
     onData: (chunk: string) => void,
     onError: (err: Error) => void
   ): Promise<() => void> {
     const url = 'https://api.twitter.com/2/tweets/search/stream?tweet.fields=referenced_tweets,public_metrics,entities,attachments&expansions=attachments.media_keys,author_id&user.fields=id,username';
     const res = await fetch(url, {
       headers: { Authorization: `Bearer ${settings.twitterBearerToken}` }
     });
     if (!res.ok) throw new Error(`Stream connect failed: ${res.status}`);
     if (!res.body) throw new Error('No response body');

     const reader = res.body.getReader();
     const decoder = new TextDecoder();
     let active = true;

     (async () => {
       try {
         while (active) {
           const { done, value } = await reader.read();
           if (done) break;
           const chunk = decoder.decode(value, { stream: true });
           if (chunk.trim()) onData(chunk);  // skip heartbeat empty lines
         }
       } catch (err) {
         if (active) onError(err instanceof Error ? err : new Error(String(err)));
       }
     })();

     return () => { active = false; reader.cancel(); };
   }
   ```

6. Export all new functions alongside existing exports

## Todo List

- [x] Add `IStreamRule` and `IStreamRuleAdd` interfaces
- [x] Implement `getStreamRules()`
- [x] Implement `addStreamRules()`
- [x] Implement `deleteStreamRules()`
- [x] Implement `connectFilteredStream()`
- [x] Export new functions
- [x] Verify file stays under 200 lines (split to `xStreamTypes.ts` if needed)
- [x] Run `npm run build` — confirm no compile errors

## Success Criteria

- All 4 stream functions exported and typed
- `connectFilteredStream()` returns a disconnect function
- Empty heartbeat lines are silently skipped
- Build passes with no TypeScript errors

## Risk Assessment

- **File size:** `xApiClient.ts` may exceed 200 lines — extract types/stream methods to `xStreamTypes.ts` if needed
- **Tweet fields:** Must include `referenced_tweets` in stream URL params to enable retweet/quote detection (same as `getUserTweets()`)
