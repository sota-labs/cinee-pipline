# Spec: Task Priority + Handle Group Flow Isolation

**Date:** 2026-05-22  
**Status:** Draft

---

## Problem Statement

Worker hiện pick task theo `created_at ASC` — không có priority, không có flow isolation per handle. Hệ quả:

- Một handle tier S (crawl mỗi 30 phút) không được ưu tiên hơn tier C
- Nếu nhiều batch_crawl tasks tồn tại cùng lúc, worker có thể xen kẽ giữa các handles: crawl A → crawl B → analyze A → analyze B → suggest A → suggest B, thay vì A hoàn chỉnh trước rồi mới B
- Không có cơ chế đảm bảo `batch_crawl → comment_crawl → analyze → suggest_reply` của một handle chạy liên tục trước khi chuyển sang handle khác

---

## User Stories

- Là operator, tôi muốn handle tier S được xử lý trước tier C để reply kịp thời với KOL quan trọng
- Là operator, tôi muốn toàn bộ flow của handle A (crawl → analyze → suggest) hoàn thành trước khi worker chuyển sang handle B, để tránh context switching lãng phí
- Là operator, tôi muốn tasks không liên quan đến KOL (own_account, self_reply) chạy khi không có KOL flow nào đang active

---

## Design

### 1. Schema Changes — Task model

Thêm 2 fields vào `ITask` và `taskSchema`:

```typescript
/** KOL handle this task belongs to. null for non-KOL tasks (own_account, self_reply). */
handle_group?: string;

/** Execution priority. Higher = picked first. Default 0. */
priority: number;
```

Index mới:
```typescript
taskSchema.index({ status: 1, priority: -1, created_at: 1 });
```

Index cũ `{ status: 1, created_at: 1 }` giữ nguyên (dùng cho backward compat queries).

**Priority values (convention, không enum):**
| Tier | Priority |
|------|----------|
| S    | 40       |
| A    | 30       |
| B    | 20       |
| C    | 10       |
| Non-KOL (own_account, self_reply) | 0 |

Downstream tasks (analyze, suggest, execute_reply) kế thừa priority của parent handle.

---

### 2. Priority Propagation — nơi Task.create() được gọi

#### 2a. `createBatchCrawlTask(kols, priority)` — kolCrawlerService.ts

Thêm param `priority: number`. Caller (`crawlDueKols`) tính priority từ tier của KOL trong chunk.

Vì một batch task có thể chứa nhiều handles với tier khác nhau, dùng **max priority** trong chunk.

```typescript
async function createBatchCrawlTask(kols: IKolCrawlInfo[], priority: number): Promise<string>
```

Payload thêm `priority` để downstream tasks có thể kế thừa:
```typescript
payload: {
  action: "batch_crawl",
  kolCount: kols.length,
  handles: kols.map(k => k.handle),
  sinceByHandle: ...,
  priority,           // NEW
}
```

Task.create thêm:
```typescript
priority,
handle_group: kols.length === 1 ? kols[0].handle : null, // single-handle chunk → set group
```

> **Note:** Khi `chunkSize > 1`, một task chứa nhiều handles → `handle_group = null` (không thể isolate per-handle). Flow isolation chỉ hoạt động khi `crawl_handles_per_task = 1`. Spec này không thay đổi chunk logic — đây là trade-off đã chấp nhận.

#### 2b. `createCommentCrawlTask(posts, priority, handleGroup)` — kolCrawlerService.ts

Được gọi từ `processBatchCrawlResult`. Cần nhận priority + handle_group từ parent task payload.

```typescript
async function createCommentCrawlTask(
  posts: Array<{ id: string; post_url: string }>,
  priority: number,
  handleGroup: string | null,
): Promise<string>
```

#### 2c. `queueAnalysisTask(type, prompt, relatedId, priority, handleGroup)` — kolAnalyzerService.ts

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

`queuePostAnalysis(post)` cần lookup priority từ KolProfile của post:
```typescript
const kol = await KolProfile.findById(post.kol_id).select("tier handle");
const priority = tierToPriority(kol.tier);
const handleGroup = kol.handle;
```

#### 2d. `generateSuggestions(postId)` — replyEngineService.ts

Đã có `kol` object trong scope (line 124). Thêm:
```typescript
const priority = tierToPriority(kol.tier);
// pass to Task.create
```

#### 2e. `queueReplyExecution(postUrl, replyContent, suggestionId, priority, handleGroup)` — replyEngineService.ts

Được gọi từ `executeReply`. Cần lookup priority từ suggestion → post → kol.

#### 2f. Non-KOL tasks — ownAccountService, selfReplyService

Không thay đổi signature. Khi Task.create không truyền `priority`, default = 0 (schema default). `handle_group = null`.

---

### 3. Worker Poll Logic — worker.js

#### Hiện tại
```javascript
async function fetchPendingTasks(limit) {
  const body = await apiFetch(`/api/tasks?status=pending&limit=${limit}`);
  return body.tasks ?? [];
}
```

API sort by `created_at ASC` — không có priority, không có handle isolation.

#### Mới — 2-step poll

**Step 1:** Tìm active handle (handle đang có task `processing`):
```
GET /api/tasks?status=processing&limit=1
```
→ Nếu có task processing: `activeHandle = task.handle_group`

**Step 2:** Pick next task dựa trên activeHandle:
- Nếu `activeHandle != null`: pick task pending có `handle_group = activeHandle` (tiếp tục flow đang dở)
- Nếu `activeHandle == null`: pick task pending có priority cao nhất (bắt đầu flow mới)

Worker không cần state — derive hoàn toàn từ DB mỗi poll cycle.

#### API endpoint thay đổi

`GET /api/tasks` cần hỗ trợ thêm query params:
- `handle_group` — filter by handle_group (exact match hoặc `null`)
- sort by `priority DESC, created_at ASC` khi không có handle_group filter

Hoặc đơn giản hơn: thêm endpoint `GET /api/tasks/next-pending` để worker gọi 1 lần, server tự xử lý logic 2-step.

**Chọn `GET /api/tasks/next-pending`** — encapsulate logic trong server, worker đơn giản hơn.

```
GET /api/tasks/next-pending
Response: { task: ITask | null }
```

Server logic:
```typescript
// 1. Check active handle
const processingTask = await Task.findOne({ status: "processing" })
  .select("handle_group");
const activeHandle = processingTask?.handle_group ?? null;

// 2. Build query
let query: FilterQuery<ITask>;
if (activeHandle) {
  // Continue active handle's flow
  query = { status: "pending", handle_group: activeHandle };
} else {
  // Start highest-priority flow (include null handle_group for non-KOL tasks)
  query = { status: "pending" };
}

// 3. Pick best task
const task = await Task.findOne(query)
  .sort({ priority: -1, created_at: 1 });
```

Worker thay `fetchPendingTasks(slots)` bằng `fetchNextPendingTask()`:
```javascript
async function fetchNextPendingTask() {
  const body = await apiFetch("/api/tasks/next-pending");
  return body.task ?? null;
}
```

---

### 4. Tier → Priority Helper

Shared utility, dùng ở nhiều service:

```typescript
// src/utils/taskPriority.ts
export function tierToPriority(tier: string): number {
  const map: Record<string, number> = { S: 40, A: 30, B: 20, C: 10 };
  return map[tier] ?? 10;
}
```

---

### 5. Data Flow Diagram

```
crawlDueKols()
  ├─ KOL tier S → priority=40
  ├─ KOL tier A → priority=30
  └─ createBatchCrawlTask(chunk, maxPriority)
       └─ Task { priority=40, handle_group="elonmusk" }

Worker poll → GET /api/tasks/next-pending
  ├─ No processing task → pick highest priority pending
  └─ Returns Task { priority=40, handle_group="elonmusk" }

Worker executes batch_crawl for "elonmusk"
  └─ PATCH /api/tasks/:id/complete
       └─ processBatchCrawlResult()
            └─ createCommentCrawlTask(posts, priority=40, handle_group="elonmusk")
                 └─ Task { priority=40, handle_group="elonmusk" }

Worker poll → GET /api/tasks/next-pending
  ├─ No processing task → pick highest priority pending
  └─ Returns comment_crawl Task for "elonmusk" (priority=40)

Worker executes comment_crawl
  └─ PATCH /api/tasks/:id/complete
       └─ processCommentCrawlResult()
            └─ queuePostAnalysis(post)
                 └─ queueAnalysisTask(..., priority=40, handle_group="elonmusk")
                      └─ Task { priority=40, handle_group="elonmusk" }

... và cứ thế cho đến execute_reply
```

---

### 6. Edge Cases

**E1 — Batch task với nhiều handles (chunkSize > 1)**  
`handle_group = null` → worker không thể isolate. Downstream tasks (comment_crawl, analyze) sẽ có `handle_group` của từng handle riêng (vì được tạo per-handle trong `processBatchCrawlResult`). Flow isolation chỉ áp dụng từ phase 2 trở đi.

**E2 — Worker restart giữa chừng**  
Task đang `processing` vẫn còn trong DB. Poll tiếp theo sẽ thấy `activeHandle` từ task đó và tiếp tục đúng handle. Không mất state.

**E3 — Task processing bị stuck (worker crash)**  
Task mãi ở `processing`. Worker mới sẽ luôn thấy `activeHandle` từ task stuck đó và không pick task nào khác. Cần timeout/recovery mechanism — **ngoài scope của spec này**, nhưng cần note để implement sau.

**E4 — Non-KOL task (priority=0, handle_group=null)**  
Chỉ được pick khi không có KOL task nào pending. Đúng với yêu cầu.

**E5 — Nhiều handles cùng priority**  
Sort by `created_at ASC` → handle nào có task cũ hơn được pick trước. Fair FIFO trong cùng tier.

---

### 7. Files Cần Thay Đổi

| File | Thay đổi |
|------|----------|
| `src/db/models/Task.ts` | Thêm `priority`, `handle_group` fields + index |
| `src/utils/taskPriority.ts` | **Tạo mới** — `tierToPriority()` helper |
| `src/services/kolCrawlerService.ts` | `createBatchCrawlTask`, `createCommentCrawlTask` nhận priority + handle_group |
| `src/services/kolAnalyzerService.ts` | `queueAnalysisTask`, `queuePostAnalysis` lookup + pass priority/handle_group |
| `src/services/replyEngineService.ts` | `generateSuggestions`, `queueReplyExecution`, `executeReply` pass priority/handle_group |
| `src/routes/tasks.ts` | Thêm `GET /api/tasks/next-pending` endpoint; pass priority/handle_group trong webhook hooks |
| `worker/worker.js` | Thay `fetchPendingTasks` bằng `fetchNextPendingTask` gọi `/api/tasks/next-pending` |

---

### 8. Testing Strategy

- Unit: `tierToPriority()` — all tiers + unknown tier
- Integration: Tạo tasks với priority khác nhau, verify `next-pending` trả về đúng thứ tự
- Integration: Tạo task `processing` với `handle_group="A"`, verify `next-pending` chỉ trả về task của handle A
- Manual: Chạy worker với 2 handles khác tier, verify log thứ tự execution

---

### 9. Risks

| Risk | Mitigation |
|------|-----------|
| Task stuck ở `processing` block toàn bộ queue | Note để implement timeout recovery sau |
| chunkSize > 1 làm mất handle isolation ở phase 1 | Document rõ, recommend `crawl_handles_per_task = 1` |
| DB query thêm mỗi poll cycle (check processing task) | Query nhẹ, indexed by status, không đáng kể |

---

### 10. Success Criteria

- Worker log thứ tự: handle A batch_crawl → comment_crawl → analyze → suggest → execute, rồi mới handle B
- Task tier S được pick trước tier C khi cả hai pending
- Non-KOL tasks chỉ chạy khi queue KOL rỗng
- Worker restart không mất flow isolation
