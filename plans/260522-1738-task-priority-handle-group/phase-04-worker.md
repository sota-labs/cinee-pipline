# Phase 04 — Worker: Dùng next-pending Endpoint

## Context

- Spec: [spec-260522-task-priority-handle-group.md](../reports/spec-260522-task-priority-handle-group.md)
- Depends on: Phase 03 (API endpoint)
- File: `worker/worker.js`

## Overview

- **Priority:** P1
- **Status:** Pending
- **Effort:** 15m
- Thay `fetchPendingTasks(slots)` bằng `fetchNextPendingTask()` gọi `/api/tasks/next-pending`.

## Related Code Files

- **Modify:** `worker/worker.js`

## Implementation Steps

### Step 1 — Thêm `fetchNextPendingTask()`

```javascript
async function fetchNextPendingTask() {
  const body = await apiFetch("/api/tasks/next-pending");
  return body.task ?? null;
}
```

### Step 2 — Cập nhật `poll()`

Thay toàn bộ logic fetch + loop trong `poll()`:

**Trước:**
```javascript
async function poll() {
  const slots = MAX_CONCURRENT_TASKS - inFlight.size;
  if (slots <= 0) {
    log.info(`openclaw busy (${inFlight.size}/${MAX_CONCURRENT_TASKS}) — waiting`);
    return;
  }

  let tasks;
  try {
    tasks = await fetchPendingTasks(slots);
  } catch (err) {
    log.error(`fetch pending tasks failed: ${err.message}`);
    return;
  }

  if (tasks.length === 0) {
    log.info("no pending tasks");
    return;
  }

  log.info(`${tasks.length} pending task(s) found`);

  for (const task of tasks) {
    if (inFlight.has(task._id)) continue;
    inFlight.add(task._id);
    processTask(task).finally(() => inFlight.delete(task._id));
    break;
  }
}
```

**Sau:**
```javascript
async function poll() {
  if (inFlight.size >= MAX_CONCURRENT_TASKS) {
    log.info(`openclaw busy (${inFlight.size}/${MAX_CONCURRENT_TASKS}) — waiting`);
    return;
  }

  let task;
  try {
    task = await fetchNextPendingTask();
  } catch (err) {
    log.error(`fetch next pending task failed: ${err.message}`);
    return;
  }

  if (!task) {
    log.info("no pending tasks");
    return;
  }

  if (inFlight.has(task._id)) return;

  log.info(`next task: ${task._id} (${task.type}) priority=${task.priority ?? 0} handle=${task.handle_group ?? "none"}`);
  inFlight.add(task._id);
  processTask(task).finally(() => inFlight.delete(task._id));
}
```

## Todo

- [ ] Thêm `fetchNextPendingTask()` function
- [ ] Cập nhật `poll()` để dùng `fetchNextPendingTask`
- [ ] Verify log output hiển thị priority + handle_group

## Success Criteria

- Worker log: `next task: <id> (type) priority=40 handle=elonmusk`
- Worker không còn gọi `/api/tasks?status=pending&limit=N`
- Restart worker giữa chừng → tiếp tục đúng handle đang dở

## Risk Assessment

- **Low.** Thay thế hoàn toàn fetch logic, không ảnh hưởng execution logic.
- `fetchPendingTasks` có thể giữ lại (unused) hoặc xóa — nên xóa để tránh confusion.
