# Phase 2 — OpenClaw Batch Task Creation

## Context Links
- Existing batch result path: `src/services/kolCrawlerService.ts:200-313` (`processBatchCrawlResult`)
- Webhook that processes batch results: `src/routes/tasks.ts:296-310`
- KOL selection logic to reuse: `src/services/kolCrawlerService.ts:540-619` (`crawlDueKols`)
- Task creation pattern: `src/services/ownAccountCrawlerService.ts:67-101` (`queueCrawlTask`)
- Tweet script helper: `src/utils/kolCrawlScript.ts:56-59` (`buildTweetScript`)
- Prompt template: `src/services/ownAccountCrawlerService.ts:39-58` (`buildOwnAccountCrawlPrompt`)

## Overview
- **Priority**: P1
- **Status**: pending
- **Description**: Add `createBatchCrawlTasks(tiers, options?)` to `kolCrawlerService.ts`. The function queries KOLs due for the given tiers, and for each KOL it creates one `Task` record with `agent: settings.openClawAgent`, `payload.action = "batch_crawl"`, and a prompt that tells the OpenClaw browser agent to scrape the KOL's profile page and POST results back to `/api/tasks/:id/process-result`. The existing `processBatchCrawlResult` and webhook handle the rest.

## Requirements

### Functional
1. New function signature:
   ```typescript
   export interface ICreateBatchTasksOptions {
     /** When true, ignore `last_crawled_at` and create a task for every active KOL in the tiers. Default: false. */
     forceAll?: boolean;
     /** Per-tier max number of KOLs to enqueue (cap to avoid quota blow-up). Default: 50. */
     maxPerTier?: number;
   }
   export async function createBatchCrawlTasks(
     tiers: Array<"S" | "A" | "B" | "C">,
     options?: ICreateBatchTasksOptions,
   ): Promise<{ tasksCreated: number; handles: string[]; skipped: string[] }>
   ```
2. Reuse the KOL selection predicate from `crawlDueKols()`:
   - `is_active: true`
   - `reputation_score >= safety.min_kol_trust_score`
   - `tier ∈ tiers`
   - `last_crawled_at` older than `tier_crawl_intervals[tier]` (or `null`); if `forceAll`, skip the cutoff.
3. For each selected KOL:
   - Compute `since = max(last_crawled_at, now - tier_crawl_intervals[tier] * 60_000)`.
   - Build a prompt using `buildTweetScript(since.toISOString())` embedded in an OpenClaw agent instruction (copy verbatim from `buildOwnAccountCrawlPrompt`).
   - Create a Task with `type: ETaskType.SINGLE_TASK_TRIGGER`, `agent: settings.openClawAgent`, `priority: 0`, `handle_group: kol.handle` (so the worker doesn't run two tasks on the same KOL concurrently), and payload:
     ```typescript
     {
       action: "batch_crawl",
       handles: [kol.handle],
       sinceByHandle: { [kol.handle]: since.toISOString() },
       priority: 0,
       handle_group: kol.handle,
     }
     ```
4. Concurrency: use `pLimit(kolSettings.crawl_concurrency)` to throttle Task creation (mirror `crawlDueKols`).
5. Continue on error: if a single Task.create fails, log and continue. Return summary counts.
6. Skip-Tier-S-aware: when called with `tiers = ["S"]` in off-prime mode, the function should still create batch tasks for Tier S (this is the off-prime S path).

### Non-functional
- Pure DB I/O — no X API calls, no browser automation triggered by this service.
- Must not require any change to cinee-worker; payload/action contract is already understood (see `routes/tasks.ts:296-310`).
- Function is exported as a **named export** alongside the existing `crawlDueKols` (so it can be imported by `kolDaemon`).

## Architecture

### Data flow
```
kolDaemon (cron) → createBatchCrawlTasks(['S','A'])
  → query KolProfile (active + tier in ['S','A'] + last_crawled_at cutoff)
  → for each kol, Task.create({ ..., payload: { action: "batch_crawl", handles: [h], sinceByHandle, ... } })
  → cinee-worker picks up task (via /api/tasks/next-pending)
  → browser agent runs tweetScript on https://x.com/<handle>
  → POST /api/tasks/:id/complete with { result: "RESPONSE\n{...}\nEND" }
  → webhook routes/tasks.ts:296 catches payload.action === "batch_crawl"
  → processBatchCrawlResult(task.result, handles, sinceByHandle) is called
  → processBatchCrawlResult handles the rest (KolPost dedup, last_crawled_at update, comment crawl)
```

### Why this works as-is
- `processBatchCrawlResult` (line 205) already handles a single KOL or multiple — it iterates over `parseBatchCrawlResult` results keyed by `handle`.
- The webhook (line 296) checks `payload.action === "batch_crawl" && Array.isArray(payload.handles)` and calls the same function.
- The Task payload schema is `Mixed` (line 59 of `Task.ts`) so adding new fields is safe.

## Related Code Files

### Modify
- `src/services/kolCrawlerService.ts`:
  - Add `createBatchCrawlTasks` function (after `crawlDueKols`, ~line 619).
  - Re-export the function and its types from the module.

### Add (extracted helper — optional, only if file > 200 lines)
- `src/utils/kol-batch-prompt.ts` — `buildBatchCrawlPrompt(handle, since)`. (Prefer to keep inline to avoid file fragmentation; the kolCrawlerService file is currently 624 lines and Phase 4 will remove ~210 of them, so we'll be under 200 net.)

## Implementation Steps

1. **Extract** the KOL selection query from `crawlDueKols` into a private `selectKolsDueForTier(tiers, intervals, cutoff, minTrustScore, forceAll)` function so it can be called by both `crawlDueKols` (kept briefly for backwards compat) and `createBatchCrawlTasks`. (Note: `crawlDueKols` is deleted in Phase 4, so this is for the transition period only.)
2. Add `createBatchCrawlTasks(tiers, options?)`:
   - `const settings = await KolSettings.getSettings();`
   - Compute per-tier cutoffs.
   - Query KOLs.
   - Use `pLimit` to map to `Task.create` calls.
   - Build the prompt by porting `buildOwnAccountCrawlPrompt` to a KOL variant that takes `(handle, since)` and embeds the tweetScript.
   - Set `handle_group = kol.handle` on every task.
   - Return summary.
3. Add try/catch around each `Task.create` — log, increment `skipped` count, continue.
4. (Optional) Add a `sinceByHandle` to handle the case where some KOLs in a task group have different `last_crawled_at` — for simplicity, since each task covers one KOL, `sinceByHandle` is always 1 entry.

## Todo List
- [ ] `createBatchCrawlTasks` implemented
- [ ] Prompt builder (`buildBatchCrawlPrompt`) implemented
- [ ] pLimit concurrency throttling
- [ ] handle_group set per KOL
- [ ] Try/catch with continue-on-error
- [ ] typecheck passes

## Success Criteria
- `createBatchCrawlTasks(["A"])` with 5 active Tier A KOLs creates exactly 5 Task records.
- Each Task has `payload.action === "batch_crawl"`, `payload.handles.length === 1`, `payload.handle_group === <handle>`.
- One failing Task.create does NOT abort the rest.

## Risk Assessment
- **Mid risk**: if cinee-worker is down, Tasks accumulate. Add a TTL via `completed_at` cleanup in `executeSessionCleanup` or a future "stale task reaper" — out of scope for this refactor, document as follow-up.
- **Low risk**: payload schema change — additive only, existing webhook handler ignores unknown fields.

## Security Considerations
- Prompt text is server-controlled (no user input), no injection risk.
- `handle_group` is server-controlled.

## Open Questions
- Should `createBatchCrawlTasks` be called from any other entrypoint (e.g. an admin API) for manual batch triggering? **Decision: out of scope; the function is exported so it can be wired later.**

## Next Steps
- Phase 3: `kolDaemon` calls `createBatchCrawlTasks` from cron jobs.
