# Phase 02 — Implement KolStreamService

**Spec:** [spec.md](./spec.md) | **Plan:** [plan.md](./plan.md)

## Overview

- **Priority:** P1
- **Status:** Completed
- **Effort:** 3h
- **Blocked by:** Phase 01

Core service that manages the X Filtered Stream connection, syncs filter rules for Tier S/A KOLs, and emits processed posts to a callback.

## Key Insights

- Basic tier: max 25 rules, each up to 512 chars. Rule format: `(from:ID1 OR from:ID2 ...) -is:retweet`
- Each `from:` clause is ~25 chars. With ` OR ` separators, ~15 user IDs fit per rule safely
- 25 rules × 15 IDs = 375 Tier S/A KOLs max — sufficient for scenario B
- Rule sync is idempotent: fetch current → diff → add missing → delete stale (matched by `tag`)
- Use rule `tag` = `"kol-stream-{batch-index}"` for tracking which rules belong to this service
- Stream events are newline-delimited JSON — a single chunk may contain multiple events or a partial event; must buffer and split on `\n`
- Reuse `mapTweetToPost()` and `shouldDropAtCrawl()` from `kolCrawlerService.ts` — no duplication
- `kolId` lookup: build a `Map<string, string>` (x_user_id → kolId) at sync time for O(1) lookup per event

## Requirements

- `connect(onPost)` — start stream, reconnect on disconnect with exponential backoff
- `disconnect()` — graceful shutdown
- `syncRules(kols)` — idempotent rule sync, called at startup and on KOL changes
- `getStreamHealth()` — returns last event time, reconnect count, active rule count
- Must not crash on malformed JSON events
- Must not disconnect stream on `processCrawlResults()` errors
- File under 200 lines — split into `kolStreamRuleManager.ts` if rule logic is large

## Related Code Files

- **Create:** `src/services/kolStreamService.ts`
- **Create (if needed):** `src/services/kolStreamRuleManager.ts` — rule sync logic
- **Read (reuse):** `src/services/kolCrawlerService.ts` — `shouldDropAtCrawl()`, `processCrawlResults()`
- **Read (reuse):** `src/services/platforms/x/xResultMapper.ts` — `mapTweetToPost()`

## Implementation Steps

1. Define interfaces:
   ```typescript
   export interface IStreamHealth {
     connected: boolean;
     lastEventAt: Date | null;
     reconnectCount: number;
     activeRuleCount: number;
   }
   ```

2. Build `buildStreamRules(kols: IKolProfile[]): IStreamRuleAdd[]`:
   - Filter kols with `x_user_id` populated; log warning for those without
   - Chunk into groups of 15
   - Each chunk → `{ value: "(from:ID1 OR from:ID2 ...) -is:retweet", tag: "kol-stream-N" }`
   - Return array of rules

3. Implement `syncRules(kols: IKolProfile[])`:
   ```typescript
   async function syncRules(kols: IKolProfile[]): Promise<void> {
     const current = await getStreamRules();
     const desired = buildStreamRules(kols);
     // Delete rules with tag starting "kol-stream-" not in desired
     const toDelete = current.filter(r => r.tag?.startsWith('kol-stream-')).map(r => r.id);
     if (toDelete.length) await deleteStreamRules(toDelete);
     // Add all desired (full replace — simpler than diff for rule sets)
     if (desired.length) await addStreamRules(desired);
     logger.info('Stream rules synced', { ruleCount: desired.length });
   }
   ```

4. Implement `parseStreamEvent(chunk: string): XApiTweet | null`:
   - Split chunk on `\n`, try JSON.parse each non-empty line
   - Return `data.data` (the tweet object) or null on parse error
   - Log malformed events at debug level

5. Implement `connect(onPost, kolIdMap)`:
   - Call `connectFilteredStream()` from xApiClient
   - Buffer incomplete lines across chunks
   - On each complete line: `parseStreamEvent()` → `mapTweetToPost()` → `shouldDropAtCrawl()` → call `onPost(rawPost, kolId)`
   - On error: log, schedule reconnect with backoff
   - Backoff: `Math.min(1000 * 2^attempt, 300_000)` ms (1s → 2s → 4s → ... → 5min)

6. Implement `disconnect()`:
   - Call disconnect function returned by `connectFilteredStream()`
   - Set `connected = false`, clear reconnect timer

7. Implement `getStreamHealth()`: return current state snapshot

8. Export: `connect`, `disconnect`, `syncRules`, `getStreamHealth`

## Todo List

- [x] Define `IStreamHealth` interface
- [x] Implement `buildStreamRules()` with 15-ID chunking
- [x] Implement `syncRules()` — full replace strategy
- [x] Implement `parseStreamEvent()` with line buffering
- [x] Implement `connect()` with exponential backoff reconnect
- [x] Implement `disconnect()`
- [x] Implement `getStreamHealth()`
- [x] Log warning for KOLs missing `x_user_id`
- [x] Verify file under 200 lines
- [x] Run `npm run build` — confirm no compile errors

## Success Criteria

- `syncRules()` is idempotent — calling twice produces same rule set
- Malformed JSON events are logged and skipped, stream stays connected
- Reconnect fires after disconnect with correct backoff delays
- `kolIdMap` lookup correctly maps `author_id` → MongoDB `_id`

## Risk Assessment

- **Partial chunks:** Stream may split a JSON event across multiple `read()` calls — must buffer and split on `\n` not on chunk boundaries
- **Rule limit:** If Tier S/A KOLs exceed 375, log error and prioritize Tier S (sort by tier before chunking)
- **x_user_id missing:** Skip silently + warn; polling fallback covers these KOLs

## Security Considerations

- Bearer token used only in Authorization header, never logged
- No user-provided data in rule values — only `x_user_id` from DB (numeric string, safe)
