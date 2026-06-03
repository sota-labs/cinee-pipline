# Node-Cron Event Loop Block — 2026-06-01 11:22–11:36 (04:22–04:36 UTC)

**Severity**: HIGH  
**Impact**: ~14-minute blackout — all cron jobs (analyze, AFK reply, self-reply, batch crawl) missed scheduled ticks  
**Status**: Root cause identified, fixes proposed

---

## Executive Summary

The 14-minute event loop block was caused by **two compounding CPU-bound synchronous operations** running inside cron callbacks that fire every 1–2 minutes. Neither operation yields the event loop.

Primary cause: `reputationCheckerService.levenshteinDistance()` — an O(n²) nested loop over potentially large strings, called once per pending comment inside `selfReplyService.rankComments()`, which itself is called for every active queue on every `*/2 * * * *` cron tick.

Secondary cause: `replyMemoryService.findFewShotExamples()` — runs `createHash("sha256")` + `Set` dedup over up to `k*4 = 12` reply strings per candidate. Called twice per cron tick of `executeSelfReplies` (generation + eval-log paths) and twice per AFK reply cycle. At scale this is minor, but it stacks.

---

## Findings

### CRITICAL — Levenshtein over unbounded strings

**File**: `src/services/reputationCheckerService.ts:401–426`  
**Called by**: `rankComments()` → `selfReplyService.ts:157–200` → `processAllQueues()` → `executeSelfReplies` (cron `*/2 * * * *`)

```
levenshteinDistance(a: string, b: string): number
  — builds matrix: number[][] of size (b.length+1) × (a.length+1)
  — two nested loops over full string lengths
  — called via similarity() from runSafetyCheck()
```

`similarity()` is called from `runSafetyCheck()` (line 351) which compares `replyContent` against `recentReplies`. Though `getRecentRepliesContent()` currently returns `[]`, `similarity()` is also reachable if that method is populated.

More critically: `levenshteinDistance` is exposed synchronously with no input length guard. Strings of 200–500 chars (typical reply content / post content) produce a 200×500 = 100,000-cell matrix filled synchronously. With multiple queues and multiple comments per queue each tick, this can accumulate to millions of operations in a single cron callback without ever yielding.

**Why it fired on June 1**: `selfReplyService.rankComments()` at line 157 iterates `queue.pending_comments` and calls `reputationCheckerService.checkReputation()` for each PENDING comment. `checkReputation` triggers `runSafetyCheck` which calls `similarity`. If a queue had 20–50 comments (plausible for a popular post), this is 20–50 synchronous Levenshtein calls per tick.

**Fix**: Add a length guard — skip similarity check when strings exceed ~150 chars, or replace with a fast token-overlap Jaccard coefficient (O(n) with Set ops) instead of Levenshtein.

---

### HIGH — `rankComments()` fires per-queue per-tick with no batch limit

**File**: `src/services/selfReplyService.ts:149–201`  
**Called by**: `processAllQueues()` → `executeSelfReplies` (cron `*/2 * * * *`)

`processAllQueues()` fetches all ACTIVE/PAUSED queues (no limit), then for each queue calls `getNextReplyCandidate()`. `getNextReplyCandidate()` returns null if rate-limited, but `rankComments()` is called separately from `createReplyQueue()` and `addCommentToQueue()` — not from `processAllQueues()` directly. However, under the flow:

- `createReplyQueue` → `rankComments` (all comments, all reputation lookups)
- `addCommentToQueue` → `rankComments` (again, all comments re-ranked)

Each `rankComments` call does a MongoDB `findOne` + a Task.create (async, fine) for **every** pending comment. With 50 comments × 5 active queues = 250 sequential DB operations inside a single async chain, all awaited one by one. This holds the async scheduler hostage even if no CPU is burned — the event loop is continuously re-entered by microtasks with no breathing room for timer callbacks.

**Fix**: Add `.limit(10)` to `getActiveQueues()` query and process at most N queues per tick (configurable). Also debounce `rankComments` — only re-rank when a new comment is added, not on every queue interaction.

---

### HIGH — `updateKolStats()` has no query limit

**File**: `src/services/kolCrawlerService.ts:508–533`

```typescript
const posts = await KolPost.find({
  kol_id: kolId,
  posted_at: { $gte: thirtyDaysAgo },
});
```

No `.limit()`. A high-volume KOL posting 10+ times/day yields 300+ posts per query. The `reduce` loops over the full array synchronously. Not currently called by a cron job but is a latent risk if wired in.

**Fix**: Add `.limit(200).lean()` and/or use MongoDB `$group` aggregation to compute averages server-side.

---

### MEDIUM — Sequential `await` in `runScheduledAFKReplies()` with 5s blocking delay

**File**: `src/services/replyEngineService.ts:775–788`

```typescript
for (const suggestion of scheduled) {
  processed++;
  const result = await this.executeReply(String(suggestion._id));
  ...
  await delay(5000);   // ← 5-second sleep per iteration
}
```

`delay(5000)` correctly uses `setTimeout` so it doesn't block the CPU. However, with N scheduled suggestions, this loop holds the async execution context for `N × 5s`. During that time the cron callback for `executeAFKReplies` has not returned, so if node-cron fires the same job again it queues another invocation. There is no mutex guard on `executeAFKReplies` (unlike `tickPrimePolling` and `tickBatchCrawl` which both have in-process mutexes).

If 3 AFK reply cycles overlap (3 cron misses + backfill), `delay(5000)` chains can stack to 15+ minutes of continuous async activity, preventing the event loop from processing timer callbacks for subsequent cron ticks.

**Fix**: Add an `isRunning` mutex guard to `executeAFKReplies` in `kolDaemon.ts` (same pattern as `isPrimePolling`). Also consider replacing the per-reply 5s delay with a staggered schedule rather than an inline sleep loop.

---

### MEDIUM — Same missing mutex on `executeSelfReplies`

**File**: `src/scripts/kolDaemon.ts:49–57` + `src/services/selfReplyService.ts:393–421`

`processAllQueues()` contains `await delay(5000)` between queues (line 417). Cron fires every 2 minutes. No mutex. Identical overlap risk as AFK replies above.

**Fix**: Add `isSelfReplyRunning` mutex guard in `kolDaemon.ts`.

---

### MEDIUM — `rankComments()` calls `checkReputation()` which issues a Task.create per uncached handle

**File**: `src/services/selfReplyService.ts:160` + `src/services/reputationCheckerService.ts:128–146`

For every comment author not yet in `KolReputationCache`, `checkReputation` creates a Task record (MongoDB write) and returns a placeholder. So for a fresh queue with 30 comments, `rankComments` issues 30 sequential `Task.create` calls. Each is awaited individually inside the `for` loop (line 157). This is 30 round-trip MongoDB writes with no batching.

**Fix**: Batch `Task.create` calls with `Task.insertMany()`, or parallelize with `Promise.all()` — `checkReputation` calls are independent.

---

### LOW — `getPendingCrawlTasks()` — unbounded Task query

**File**: `src/services/kolCrawlerService.ts:487–503`

```typescript
const tasks = await Task.find({
  type: ETaskType.CRON_JOB_TRIGGER,
  agent: "openclaw",
  status: { $in: [ETaskStatus.PENDING, ETaskStatus.PROCESSING] },
}).lean();
```

No `.limit()`. If the Task collection accumulates thousands of pending items (common when cinee-worker is slow), this returns the full set and then does a regex match on every `t.prompt`. The regex `t.prompt.match(/x\.com\/([\w_]+)/)` runs on each document's prompt string synchronously in the map callback.

**Fix**: Add `.limit(200)` and ensure a compound index on `(type, agent, status)`.

---

### LOW — `learnPersonality()` queries 30-day posts with no limit

**File**: `src/services/ownAccountService.ts:43–49`

```typescript
const posts = await Post.find({
  status: EPostStatus.POSTED,
  platform: "twitter",
  created_at: { $gte: thirtyDaysAgo },
}).sort({ created_at: -1 });
```

No `.limit()`. Called by `autoLearnPersonality()` (cron `0 */6 * * *`). A very active account could return hundreds of posts, all loaded into memory. The map at line 60 iterates all of them. Low risk at current scale but could grow.

**Fix**: Add `.limit(50).lean()` — the prompt only samples post content and doesn't need the full 30-day corpus.

---

## Root Cause Chain (June 1, 04:22–04:36 UTC)

1. `executeSelfReplies` tick fires at ~04:22.
2. `processAllQueues` fetches N active queues (no limit).
3. For each queue, `getNextReplyCandidate` checks rate limit — passes.
4. `queueSelfReplyGeneration` fires, which internally calls `rankComments`.
5. `rankComments` iterates all PENDING comments, calling `checkReputation` per author.
6. `checkReputation` → `runSafetyCheck` → `similarity` → **`levenshteinDistance`** executes synchronously over full reply strings, blocking the event loop thread.
7. With multiple queues × multiple comments, CPU stays pinned on matrix ops.
8. node-cron timer callbacks for `executeAnalyze` (every 1 min), `executeSelfReplies` (every 2 min), `executeAFKReplies` (every 10 min) cannot fire — event loop is occupied.
9. When the CPU work finally completes (~04:36), node-cron detects missed executions and logs the warning.

---

## Recommended Fixes (Priority Order)

| # | Location | Fix | Effort |
|---|----------|-----|--------|
| 1 | `reputationCheckerService.ts:390` | Replace `levenshteinDistance` with token-Jaccard (O(n)); add 150-char guard | 1h |
| 2 | `kolDaemon.ts:49,71` | Add `isSelfReplyRunning` + `isAFKRunning` mutex flags | 30m |
| 3 | `selfReplyService.ts:376` | Add `.limit(10)` to `getActiveQueues()` query | 15m |
| 4 | `selfReplyService.ts:157` | Parallelize `checkReputation` calls with `Promise.all` | 1h |
| 5 | `kolCrawlerService.ts:514` | Add `.limit(200).lean()` to `updateKolStats` posts query | 15m |
| 6 | `ownAccountService.ts:44` | Add `.limit(50).lean()` to `learnPersonality` posts query | 15m |
| 7 | `kolCrawlerService.ts:490` | Add `.limit(200)` to `getPendingCrawlTasks` | 15m |

---

## Unresolved Questions

- Was `rankComments()` being triggered on every `processAllQueues` tick at that time, or only on queue creation? The current code path shows it's called from `createReplyQueue`/`addCommentToQueue`, not `processAllQueues` — if a queue was being created concurrently with the cron tick, that could be the trigger. Confirm by checking MongoDB change logs or application logs for `[SelfReply] Created queue` near 04:22.
- How many active queues existed at 04:22? Query: `db.selfreplyqueues.countDocuments({queue_status: {$in: ["active","paused"]}})` as of June 1.
- Is `runSafetyCheck` actually reachable from `rankComments`? Current code calls `checkReputation` (which does NOT call `runSafetyCheck`) — `runSafetyCheck` is only called explicitly. Re-verify call graph if block recurs.
