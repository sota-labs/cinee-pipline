# Phase 02 — Propagate priority/handle_group vào Services

## Context

- Spec: [spec-260522-task-priority-handle-group.md](../reports/spec-260522-task-priority-handle-group.md)
- Depends on: Phase 01 (Task model + tierToPriority)

## Overview

- **Priority:** P1
- **Status:** Pending
- **Effort:** 1h
- Cập nhật tất cả `Task.create()` calls trong services để pass `priority` và `handle_group`. Downstream tasks kế thừa từ parent qua payload hoặc DB lookup.

## Key Insights

- `createBatchCrawlTask` — caller biết tier của KOL → tính priority tại đây
- `createCommentCrawlTask` — được gọi từ `processBatchCrawlResult`, nhận priority từ parent task payload
- `queueAnalysisTask` — được gọi từ `queuePostAnalysis`, cần lookup KolProfile để lấy tier
- `generateSuggestions` — đã có `kol` object trong scope
- `queueReplyExecution` — cần lookup từ suggestion → post → kol
- Non-KOL tasks (ownAccountService, selfReplyService) — không thay đổi, default priority=0

## Related Code Files

- **Modify:** `src/services/kolCrawlerService.ts`
- **Modify:** `src/services/kolAnalyzerService.ts`
- **Modify:** `src/services/replyEngineService.ts`

## Implementation Steps

### Step 1 — `kolCrawlerService.ts`: `createBatchCrawlTask`

Thêm param `priority: number` và `handleGroup: string | null`:

```typescript
async function createBatchCrawlTask(
  kols: IKolCrawlInfo[],
  priority: number,
  handleGroup: string | null,
): Promise<string>
```

Trong `Task.create`:
```typescript
priority,
handle_group: handleGroup,
payload: {
  action: "batch_crawl",
  kolCount: kols.length,
  handles: kols.map(k => k.handle),
  sinceByHandle: ...,
  priority,        // pass xuống để downstream tasks kế thừa
  handle_group: handleGroup,
},
```

### Step 2 — `kolCrawlerService.ts`: `crawlDueKols` và `crawlAllKolsSequential`

Trong vòng lặp tạo chunk, tính priority từ tier của KOLs trong chunk:

```typescript
import { tierToPriority } from "../utils/taskPriority.js";

// Trong crawlDueKols, khi tạo chunk:
const chunkPriority = Math.max(...chunk.map(k => {
  const kol = kols.find(kl => kl.handle === k.handle);
  return tierToPriority(kol?.tier ?? "C");
}));
// handleGroup: single-handle chunk → handle name; multi-handle → null
const handleGroup = chunk.length === 1 ? chunk[0].handle : null;
await createBatchCrawlTask(chunk, chunkPriority, handleGroup);
```

> **Note:** `crawlDueKols` có `kols` array với tier info. `crawlAllKolsSequential` không có tier — dùng default priority 10.

Cần pass `kols` (với tier) vào chunk loop. Hiện tại `kolInfos` chỉ có `{ handle, since, limit }` — cần thêm `tier` vào `IKolCrawlInfo`:

```typescript
interface IKolCrawlInfo {
  handle: string;
  since: string;
  limit: number;
  tier?: string; // NEW — optional, dùng để tính priority
}
```

Trong `crawlDueKols`, khi build `kolInfos`:
```typescript
kolInfos.push({
  handle: kol.handle,
  since: since.toISOString(),
  limit: kolSettings.max_posts_per_crawl,
  tier: kol.tier,  // NEW
});
```

### Step 3 — `kolCrawlerService.ts`: `createCommentCrawlTask`

Thêm params `priority: number` và `handleGroup: string | null`:

```typescript
async function createCommentCrawlTask(
  posts: Array<{ id: string; post_url: string }>,
  priority: number,
  handleGroup: string | null,
): Promise<string>
```

Trong `Task.create`:
```typescript
priority,
handle_group: handleGroup,
payload: {
  action: "comment_crawl",
  postCount: posts.length,
  postIds: posts.map(p => p.id),
  priority,
  handle_group: handleGroup,
},
```

### Step 4 — `kolCrawlerService.ts`: `processBatchCrawlResult` — pass priority xuống comment crawl

Khi gọi `createCommentCrawlTask`, đọc priority từ parent task payload. Nhưng `processBatchCrawlResult` không nhận task object — cần thêm param:

```typescript
export async function processBatchCrawlResult(
  taskResult: string,
  handles: string[],
  sinceByHandle?: Record<string, string>,
  priority?: number,        // NEW
  handleGroup?: string | null, // NEW
): Promise<ICrawlResult[]>
```

Khi gọi `createCommentCrawlTask`:
```typescript
await createCommentCrawlTask(
  postsNeedingComments.map(p => ({ id: String(p._id), post_url: p.post_url })),
  priority ?? 0,
  handleGroup ?? null,
);
```

Caller trong `tasks.ts` webhook cần pass priority từ payload:
```typescript
const priority = (payload.priority as number) ?? 0;
const handleGroup = (payload.handle_group as string) ?? null;
const results = await processBatchCrawlResult(task.result!, handles, sinceByHandle, priority, handleGroup);
```

### Step 5 — `kolAnalyzerService.ts`: `queueAnalysisTask` + `queuePostAnalysis`

Thêm params vào `queueAnalysisTask`:

```typescript
async function queueAnalysisTask(
  type: IAnalysisTaskResult["type"],
  prompt: string,
  relatedId: string,
  model?: string,
  priority?: number,
  handleGroup?: string | null,
): Promise<string>
```

Trong `Task.create`:
```typescript
priority: priority ?? 0,
handle_group: handleGroup ?? null,
```

Trong `queuePostAnalysis`, lookup KolProfile để lấy tier:

```typescript
import { tierToPriority } from "../utils/taskPriority.js";

async queuePostAnalysis(post: IKolPost): Promise<string[]> {
  // ... existing atomic claim ...

  // Lookup KOL tier for priority
  const kol = await KolProfile.findById(post.kol_id).select("tier handle").lean();
  const priority = kol ? tierToPriority(kol.tier) : 0;
  const handleGroup = kol?.handle ?? null;

  const analysisTaskId = await queueAnalysisTask(
    "post_analysis",
    analysisPrompt,
    String(post._id),
    undefined,
    priority,
    handleGroup,
  );

  if (post.top_comments.length > 0) {
    const patternTaskId = await queueAnalysisTask(
      "comment_pattern",
      patternPrompt,
      String(post._id),
      undefined,
      priority,
      handleGroup,
    );
    // ...
  }
}
```

### Step 6 — `replyEngineService.ts`: `generateSuggestions`

Đã có `kol` object (line 124). Thêm:

```typescript
import { tierToPriority } from "../utils/taskPriority.js";

// Sau khi fetch kol:
const priority = tierToPriority(kol.tier);
const handleGroup = kol.handle;

// Trong Task.create:
priority,
handle_group: handleGroup,
payload: {
  action: "generate_suggestions",
  postId: String(postId),
  suggestionId: String(suggestion._id),
  mode,
  priority,       // pass xuống execute_reply
  handle_group: handleGroup,
},
```

### Step 7 — `replyEngineService.ts`: `queueReplyExecution` + `executeReply`

Thêm params vào `queueReplyExecution`:

```typescript
async function queueReplyExecution(
  postUrl: string,
  replyContent: string,
  suggestionId: string,
  priority?: number,
  handleGroup?: string | null,
): Promise<string>
```

Trong `Task.create`:
```typescript
priority: priority ?? 0,
handle_group: handleGroup ?? null,
```

Trong `executeReply`, lookup priority từ suggestion → post → kol:

```typescript
// Sau khi fetch post:
const kol = await KolProfile.findById(post.kol_id).select("tier handle").lean();
const priority = kol ? tierToPriority(kol.tier) : 0;
const handleGroup = kol?.handle ?? null;

const taskId = await queueReplyExecution(post.post_url, replyContent, suggestionId, priority, handleGroup);
```

## Todo

- [x] Thêm `tier?: string` vào `IKolCrawlInfo`
- [x] `createBatchCrawlTask` nhận `priority` + `handleGroup`, pass vào Task + payload
- [x] `crawlDueKols` tính priority từ tier, pass vào `createBatchCrawlTask`
- [x] `crawlAllKolsSequential` pass priority=10 (no tier info)
- [x] `createCommentCrawlTask` nhận `priority` + `handleGroup`
- [x] `processBatchCrawlResult` nhận `priority` + `handleGroup`, pass vào `createCommentCrawlTask`
- [x] `queueAnalysisTask` nhận `priority` + `handleGroup`
- [x] `queuePostAnalysis` lookup KolProfile tier, pass priority + handleGroup
- [x] `generateSuggestions` pass priority + handleGroup vào Task + payload
- [x] `queueReplyExecution` nhận `priority` + `handleGroup`
- [x] `executeReply` lookup KolProfile tier, pass priority + handleGroup
- [x] Run `tsc --noEmit` — zero errors

## Success Criteria

- `tsc --noEmit` passes
- Batch crawl task tạo ra có `priority=40` cho tier S KOL
- Comment crawl task kế thừa priority từ batch crawl parent
- Analysis tasks có `handle_group` = KOL handle
- Execute reply task có `priority` + `handle_group` đúng

## Risk Assessment

- **Medium.** Nhiều files thay đổi nhưng tất cả additive (thêm optional params). Backward compat: callers không pass priority → default 0.
- `processBatchCrawlResult` signature thay đổi — cần update caller trong `tasks.ts` (Phase 03).
