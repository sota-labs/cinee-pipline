# Phase 03 — API Endpoint next-pending + Webhook Propagation

## Context

- Spec: [spec-260522-task-priority-handle-group.md](../reports/spec-260522-task-priority-handle-group.md)
- Depends on: Phase 01 (Task model), Phase 02 (services)
- File: `src/routes/tasks.ts`

## Overview

- **Priority:** P1
- **Status:** Pending
- **Effort:** 45m
- Thêm `GET /api/tasks/next-pending` endpoint với 2-step logic. Cập nhật webhook `PATCH /:id/complete` để pass `priority` + `handle_group` vào `processBatchCrawlResult`.

## Related Code Files

- **Modify:** `src/routes/tasks.ts`

## Implementation Steps

### Step 1 — Thêm `GET /api/tasks/next-pending`

Thêm route **trước** `GET /:id` (vì `:id` sẽ match "next-pending" nếu đặt sau):

```typescript
/**
 * GET /api/tasks/next-pending
 * Worker calls this to get the next task to execute.
 * Logic:
 *   1. If a task is currently processing with a handle_group → continue that handle
 *   2. Otherwise → pick highest priority pending task
 */
tasksRouter.get("/next-pending", async (req: Request, res: Response) => {
  try {
    // Step 1: find active handle
    const processingTask = await Task.findOne({ status: ETaskStatus.PROCESSING })
      .select("handle_group")
      .lean();
    const activeHandle = processingTask?.handle_group ?? null;

    // Step 2: build query
    const query: Record<string, unknown> = { status: ETaskStatus.PENDING };
    if (activeHandle) {
      query.handle_group = activeHandle;
    }

    const task = await Task.findOne(query).sort({ priority: -1, created_at: 1 });

    res.json({ success: true, task: task ?? null });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});
```

### Step 2 — Cập nhật webhook `batch_crawl` trong `PATCH /:id/complete`

Tìm block xử lý `batch_crawl` (khoảng line 231), thêm `priority` và `handle_group`:

```typescript
if (payload.action === "batch_crawl" && Array.isArray(payload.handles)) {
  const handles = payload.handles as string[];
  const sinceByHandle = payload.sinceByHandle as Record<string, string> | undefined;
  const priority = (payload.priority as number) ?? 0;          // NEW
  const handleGroup = (payload.handle_group as string) ?? null; // NEW
  setImmediate(async () => {
    try {
      log.info(`[Webhook] Auto-processing batch_crawl result for task ${task._id}`);
      const results = await processBatchCrawlResult(
        task.result!,
        handles,
        sinceByHandle,
        priority,    // NEW
        handleGroup, // NEW
      );
      log.info(`[Webhook] batch_crawl processed: ${results.length} KOLs`);
    } catch (e: unknown) {
      log.error(`[Webhook] Error processing batch_crawl result: ${(e as Error).message}`);
    }
  });
}
```

## Todo

- [x] Thêm `GET /api/tasks/next-pending` route (trước `GET /:id`)
- [x] Cập nhật `batch_crawl` webhook block để pass `priority` + `handle_group`
- [x] Run `tsc --noEmit` — zero errors

## Success Criteria

- `GET /api/tasks/next-pending` trả về task priority cao nhất khi không có processing task
- `GET /api/tasks/next-pending` trả về task cùng `handle_group` khi có processing task
- `GET /api/tasks/next-pending` trả về `{ task: null }` khi queue rỗng
- Webhook `batch_crawl` pass priority + handle_group xuống `processBatchCrawlResult`

## Risk Assessment

- **Low.** Route mới không ảnh hưởng routes cũ. Chỉ cần đặt trước `GET /:id`.
- Edge case: nhiều tasks đang `processing` cùng lúc (không xảy ra với single-threaded worker, nhưng nếu có → `findOne` lấy task đầu tiên, acceptable).
