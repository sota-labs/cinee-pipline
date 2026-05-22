# Phase 01 — Task Model + Priority Helper

## Context

- Spec: [spec-260522-task-priority-handle-group.md](../reports/spec-260522-task-priority-handle-group.md)
- Model: `src/db/models/Task.ts`
- Helper: `src/utils/taskPriority.ts` (tạo mới)

## Overview

- **Priority:** P1
- **Status:** Pending
- **Effort:** 30m
- Thêm `priority` và `handle_group` vào `ITask` interface + schema. Tạo `tierToPriority()` helper. Thêm compound index.

## Requirements

- `priority: number` — default 0, required
- `handle_group?: string` — optional, null cho non-KOL tasks
- Index `{ status: 1, priority: -1, created_at: 1 }` để worker query hiệu quả
- `tierToPriority(tier)` — S=40, A=30, B=20, C=10, unknown=10

## Related Code Files

- **Modify:** `src/db/models/Task.ts`
- **Create:** `src/utils/taskPriority.ts`

## Implementation Steps

### Step 1 — Thêm fields vào `ITask` interface

Trong `src/db/models/Task.ts`, thêm vào `ITask`:

```typescript
/** Execution priority — higher picked first. 0 = non-KOL tasks. */
priority: number;
/** KOL handle this task belongs to. null for non-KOL tasks. */
handle_group?: string;
```

### Step 2 — Thêm fields vào schema

Trong `taskSchema`:

```typescript
priority: { type: Number, default: 0, index: true },
handle_group: { type: String, default: null },
```

### Step 3 — Thêm compound index

```typescript
taskSchema.index({ status: 1, priority: -1, created_at: 1 });
```

### Step 4 — Tạo `src/utils/taskPriority.ts`

```typescript
const TIER_PRIORITY: Record<string, number> = { S: 40, A: 30, B: 20, C: 10 };

export function tierToPriority(tier: string): number {
  return TIER_PRIORITY[tier] ?? 10;
}
```

## Todo

- [ ] Thêm `priority` và `handle_group` vào `ITask` interface
- [ ] Thêm fields vào `taskSchema`
- [ ] Thêm compound index `{ status: 1, priority: -1, created_at: 1 }`
- [ ] Tạo `src/utils/taskPriority.ts` với `tierToPriority()`
- [ ] Run `tsc --noEmit` — zero errors

## Success Criteria

- `tsc --noEmit` passes
- `Task.create({ priority: 40, handle_group: "elonmusk" })` không lỗi type
- `tierToPriority("S")` = 40, `tierToPriority("X")` = 10

## Risk Assessment

- **Low.** Additive changes only. Existing tasks không có `priority` sẽ default = 0 (MongoDB).
