---
title: "Phase 4: Add POST /:id/process-result Endpoint"
status: pending
effort: 0.5h
---

# Phase 4: Add POST /:id/process-result Endpoint

## Context Links

- [Spec](./spec.md) -- Section "New API Endpoint"
- [tasks.ts](../src/routes/tasks.ts) -- file to modify
- [Phase 3](./phase-03-modify-crawler-service.md) -- provides `processBatchCrawlResult()`

## Overview

- **Priority:** High
- **Status:** Pending
- **Description:** Add `POST /api/tasks/:id/process-result` endpoint to `src/routes/tasks.ts`. This endpoint triggers result processing for a completed batch crawl task, calling `processBatchCrawlResult()` from the service.

## Key Insights

- Endpoint is **idempotent** -- calling twice just re-processes; dedup handled by `post_url` unique index in KolPost
- Only works on tasks with `status === "completed"` and `payload.action === "batch_crawl"`
- Returns `ICrawlResult[]` so caller knows how many posts were saved per KOL
- This is a manual trigger -- webhook-based auto-processing is out of scope (Phase 2 future work)

## Requirements

### Functional
- Accept `POST /api/tasks/:id/process-result`
- Validate task exists, status is "completed", payload.action is "batch_crawl"
- Extract `handles` from `task.payload.handles`
- Call `processBatchCrawlResult(task.result, handles)`
- Return `{ success: true, results: ICrawlResult[] }`
- Return appropriate error codes: 404 (not found), 409 (wrong status/action), 500 (processing error)

### Non-functional
- Follow existing route patterns (try/catch, consistent response shape)
- No authentication added (matches existing routes -- auth is handled at gateway level)

## Architecture

```
POST /api/tasks/:id/process-result
  |-- Validate task exists (404)
  |-- Validate task.status === "completed" (409)
  |-- Validate task.payload.action === "batch_crawl" (409)
  |-- Extract handles from task.payload.handles
  |-- Call processBatchCrawlResult(task.result, handles)
  |-- Return { success, results }
```

## Related Code Files

- **Modify:** `src/routes/tasks.ts`
- **Import from:** `src/services/kolCrawlerService.ts` -- `processBatchCrawlResult`

## Implementation Steps

### Step 1: Add import at top of `src/routes/tasks.ts`

After existing imports (line 5):

```typescript
import { processBatchCrawlResult } from "../services/kolCrawlerService.js";
```

### Step 2: Add endpoint before the DELETE route (before line 194)

Insert the new endpoint after the retry route and before the delete route:

```typescript
/**
 * POST /api/tasks/:id/process-result
 * Trigger result processing for a completed batch crawl task.
 * Idempotent: re-processing skips already-saved posts (post_url unique index).
 */
tasksRouter.post("/:id/process-result", async (req: Request, res: Response) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: "Task not found" });
    }

    if (task.status !== ETaskStatus.COMPLETED) {
      return res.status(409).json({
        success: false,
        error: `Cannot process result for task with status "${task.status}" — expected "completed"`,
      });
    }

    const payload = task.payload as Record<string, unknown> | undefined;
    if (!payload || payload.action !== "batch_crawl") {
      return res.status(409).json({
        success: false,
        error: `Task is not a batch_crawl task (action: "${payload?.action ?? "none"}")`,
      });
    }

    const handles = Array.isArray(payload.handles)
      ? (payload.handles as string[])
      : [];

    if (handles.length === 0) {
      return res.status(409).json({
        success: false,
        error: "Task payload has no handles to process",
      });
    }

    if (!task.result) {
      return res.status(409).json({
        success: false,
        error: "Task has no result to process",
      });
    }

    const results = await processBatchCrawlResult(task.result, handles);

    log.info(`Task ${task._id} process-result: ${results.length} KOLs processed`);
    res.json({ success: true, results });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    log.error(`Task process-result failed: ${message}`);
    res.status(500).json({ success: false, error: message });
  }
});
```

### Step 3: Verify compilation

```bash
npx tsc --noEmit
```

## Todo List

- [ ] Add `processBatchCrawlResult` import to tasks.ts
- [ ] Add `POST /:id/process-result` endpoint
- [ ] Verify TypeScript compiles
- [ ] Manual test: create a mock completed task, call endpoint, verify response shape

## Success Criteria

- Endpoint responds at `POST /api/tasks/:id/process-result`
- Returns 404 for non-existent task
- Returns 409 for non-completed task
- Returns 409 for non-batch_crawl task
- Returns 409 for task with no handles or no result
- Returns `{ success: true, results: [...] }` for valid completed batch_crawl task
- TypeScript compiles without errors
- Follows existing route patterns (error handling, response shape, logging)

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Long-running request (many KOLs) | Medium | Batch crawl typically 5-20 KOLs; DB writes are fast. If needed, add timeout or background processing later |
| Concurrent calls to same task | Low | Idempotent by design (post_url unique index prevents duplicates) |

## Security Considerations

- No auth on this endpoint (matches existing pattern -- gateway handles auth)
- Input is task ID from URL param -- validated via Mongoose `findById` (invalid ObjectId returns null)
- No user-supplied body data used in processing

## Next Steps

- Phase 5 writes integration test for this endpoint
