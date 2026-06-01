# Spec: KOL Filtered Stream — Low-Latency Post Detection

**Date:** 2026-06-01  
**Status:** Approved  

---

## Problem Statement

Current KOL crawl pipeline is entirely polling-based. Tier S KOLs are crawled every 30 minutes, meaning detection latency can be up to 30 minutes before the analyze → reply pipeline even starts. End-to-end latency (post published → reply sent) is ~40 minutes worst case.

**Goal:** Reduce end-to-end latency to < 3 minutes for Tier S/A KOLs using X Filtered Stream API (available on Basic tier).

---

## User Stories

- As the system, when a Tier S/A KOL publishes a post, I want to detect it within seconds and immediately trigger the analyze → reply pipeline.
- As an operator, I want Tier B/C KOLs to continue working via existing polling — no regression.
- As an operator, I want the stream to auto-recover from disconnects without manual intervention.
- As an operator, I want all posts (not just top 2) from a crawl to be processed.

---

## Scope

### In scope
- X Filtered Stream connection and rule management for Tier S/A KOLs
- Event-driven pipeline trigger: stream post → immediate analyze → immediate reply generation
- Remove top-2 post cap in `crawlKol()` and `processBatchCrawlResult()`
- Stream worker as standalone process (`kolStreamWorker.ts`)
- Polling fallback: Tier S/A polling continues as safety net (can increase interval to 2h since stream covers real-time)
- Reconnect logic with exponential backoff
- Rule sync on KOL tier changes (activate/deactivate/tier update)

### Out of scope
- Replacing OpenClaw task queue for analyze/reply (too large a refactor, bottleneck is execution not queuing)
- Streaming for Tier B/C
- Comment crawl via stream (still done inline after post detection)

---

## Architecture

```
X Filtered Stream API
        │
        ▼
KolStreamService (persistent connection)
  - manages filter rules (from:user_id OR from:user_id ...)
  - parses incoming tweet events
  - calls shouldDropAtCrawl() — reuse existing filter
  - emits "new_post" events
        │
        ▼
Stream event handler
  - processCrawlResults() — save to DB
  - analyzePendingPosts() — immediate, no wait for cron
  - generateSuggestions() — immediate, no wait for cron
        │
        ▼
OpenClaw task queue (unchanged)
  - executes AI analysis
  - executes reply generation
  - executes reply posting
```

**Polling (unchanged for Tier B/C, relaxed for Tier S/A):**
- Tier S: 30min → 2h (stream is primary, polling is fallback)
- Tier A: 2h → 4h
- Tier B/C: unchanged

---

## Components

### 1. `src/services/kolStreamService.ts` (new)

Responsibilities:
- Connect to `https://api.twitter.com/2/tweets/search/stream`
- Manage filter rules via `POST /2/tweets/search/stream/rules`
- Sync rules when KOL list changes (add/remove/tier change)
- Parse SSE events → `IRawPost` via existing `mapTweetToPost()`
- Apply `shouldDropAtCrawl()` filter
- Emit processed posts to callback
- Reconnect with exponential backoff (1s → 2s → 4s → ... → 5min cap)
- Track stream health (last event time, reconnect count)

**Key methods:**
```typescript
connect(onPost: (post: IRawPost, kolId: string) => Promise<void>): Promise<void>
disconnect(): void
syncRules(kols: IKolProfile[]): Promise<void>  // called on startup + KOL changes
getStreamHealth(): IStreamHealth
```

**Rule format:**
```
(from:111 OR from:222 OR from:333) -is:retweet
```
Each rule covers up to 15 user IDs. Basic tier: 25 rules → up to 375 Tier S/A KOLs.

**Requires:** All Tier S/A KOLs must have `x_user_id` populated. Service skips KOLs without it and logs a warning.

### 2. `src/scripts/kolStreamWorker.ts` (new)

Standalone process entry point:
- Connects MongoDB + Redis
- Loads all active Tier S/A KOLs
- Calls `kolStreamService.connect()` with event handler
- Event handler: `processCrawlResults()` → `analyzePendingPosts()` → `generateSuggestions()`
- Graceful shutdown on SIGTERM/SIGINT
- Health check endpoint (optional, port configurable)

### 3. `src/services/kolCrawlerService.ts` (modify)

Remove top-2 cap:
- `crawlKol()`: remove `.slice(0, 2)` or equivalent sort+limit
- `processBatchCrawlResult()`: remove `keepTopN(2)` logic

No other changes — stream reuses `processCrawlResults()` and `shouldDropAtCrawl()` as-is.

### 4. `src/services/platforms/x/xApiClient.ts` (modify)

Add stream methods:
```typescript
connectFilteredStream(onData: (chunk: string) => void, onError: (err: Error) => void): Promise<() => void>
getStreamRules(): Promise<IStreamRule[]>
addStreamRules(rules: IStreamRuleAdd[]): Promise<IStreamRule[]>
deleteStreamRules(ids: string[]): Promise<void>
```

Uses native `fetch()` with `response.body` reader (same pattern as existing client, no new deps).

---

## Data Flow

1. X publishes tweet from Tier S/A KOL
2. Stream delivers event within ~2-5 seconds
3. `kolStreamService` parses tweet → `IRawPost`
4. `shouldDropAtCrawl()` — drop retweets, short quotes
5. `processCrawlResults()` — save to DB, calculate engagement score
6. `analyzePendingPosts()` — immediately queue analysis task (no 10min wait)
7. OpenClaw executes analysis (~30-90s depending on queue depth)
8. `generateSuggestions()` — immediately queue suggestion task
9. OpenClaw executes suggestion generation
10. AFK mode: auto-schedule reply with configured delay
11. Reply executed via OpenClaw browser automation

**Deduplication:** `processCrawlResults()` already uses upsert on `post_url` — stream + polling fallback won't create duplicates.

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Stream disconnect | Exponential backoff reconnect (1s → 5min cap) |
| X API 429 on rules endpoint | Retry after `x-ratelimit-reset`, log warning |
| KOL missing `x_user_id` | Skip from stream rules, log warning, still covered by polling |
| Rule limit exceeded (>25 rules) | Prioritize Tier S over Tier A, log error |
| Malformed stream event | Log and skip, don't crash worker |
| `processCrawlResults()` throws | Log error, continue stream (don't disconnect) |

---

## Rule Sync Strategy

Rules are synced at:
1. Worker startup — full sync of all active Tier S/A KOLs
2. KOL activated/deactivated — incremental add/remove
3. KOL tier changed to/from S or A — incremental add/remove
4. Periodic full sync every 6h — catch any drift

Sync is idempotent: fetch current rules → diff → add missing → remove stale.

---

## Testing Strategy

- Unit: `kolStreamService` rule generation, deduplication logic, reconnect backoff
- Unit: `xApiClient` stream methods with mocked fetch
- Integration: stream worker startup → rule sync → mock stream event → verify post saved + tasks queued
- Regression: existing `crawlDueKols()` polling tests unchanged

---

## Implementation Risks

| Risk | Mitigation |
|------|------------|
| KOLs missing `x_user_id` | `getUserIdByHandle()` already resolves and caches — run backfill script before enabling stream |
| Stream event volume spike | `shouldDropAtCrawl()` filters aggressively; OpenClaw queue handles backpressure |
| Basic tier 500k tweet/month cap | Tier S/A typically < 200 KOLs × ~10 posts/day = 60k/month — well within limit |
| Node.js fetch streaming support | Node 18+ supports `response.body` as ReadableStream — confirm runtime version |

---

## Files Changed

| File | Action |
|------|--------|
| `src/services/kolStreamService.ts` | Create |
| `src/scripts/kolStreamWorker.ts` | Create |
| `src/services/platforms/x/xApiClient.ts` | Modify — add stream methods |
| `src/services/kolCrawlerService.ts` | Modify — remove top-2 cap |
| `package.json` | Modify — add start script for stream worker |

---

## Success Criteria

- Tier S/A post detected within 5 seconds of publication
- End-to-end (post → reply queued) < 3 minutes
- Zero duplicate posts from stream + polling overlap
- Stream auto-recovers from disconnect within 30 seconds
- Tier B/C behavior unchanged
- All existing tests pass
