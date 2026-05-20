# Phase 1 — Add --session-id to task commands

**Status:** pending
**File:** `src/services/kolCrawlerService.ts`

## Context

Currently all 3 task creation functions build the openclaw command without `--session-id`, causing all tasks to share the default session of agent `main` and accumulate history until context overflow.

## Implementation Steps

Each function follows the same pattern: build command → `Task.create()` → return `String(task._id)`.
The fix is to move `Task.create()` before building the command string so `task._id` is available.

### 1. `createBatchCrawlTask()`

```typescript
// Create task first to get _id for session-id
const task = await Task.create({
  type: ETaskType.SINGLE_TASK_TRIGGER,
  agent: settings.openClawAgent,
  prompt: "", // placeholder, updated below
  status: ETaskStatus.PENDING,
  payload: {
    action: "batch_crawl",
    kolCount: kols.length,
    handles: kols.map(k => k.handle),
  },
});

const command = `agent --agent ${settings.openClawAgent} --thinking off --session-id ${task._id} --message '${escapedPrompt}'`;
task.prompt = command;
await task.save();
```

**Simpler alternative** — build command after create, update prompt:
```typescript
const task = await Task.create({ ..., prompt: "pending" });
const command = `agent --agent ${settings.openClawAgent} --thinking off --session-id ${task._id} --message '${escapedPrompt}'`;
await Task.findByIdAndUpdate(task._id, { prompt: command });
```

**Simplest alternative** — use a temp placeholder then patch:
Actually the cleanest approach is to just patch the prompt field after create since worker reads it at execution time, not at creation time.

### Final approach for all 3 functions:

1. Call `Task.create()` with the command string that doesn't yet have session-id (or a placeholder)
2. Build final command using `task._id`
3. Update `task.prompt` with the final command

```typescript
// Step 1: create task
const task = await Task.create({
  type: ETaskType.SINGLE_TASK_TRIGGER,
  agent: settings.openClawAgent,
  prompt: "pending",
  status: ETaskStatus.PENDING,
  payload: { ... },
});

// Step 2: build command with session-id
const command = `agent --agent ${settings.openClawAgent} --thinking off --session-id ${task._id} --message '${escapedPrompt}'`;

// Step 3: update prompt
task.prompt = command;
await task.save();
```

Apply this pattern to:
- `createBatchCrawlTask()` — type `SINGLE_TASK_TRIGGER`
- `createCommentCrawlTask()` — type `KOL_COMMENT_CRAWL`
- `createCrawlTask()` — type `CRON_JOB_TRIGGER`

## Todo

- [ ] Refactor `createBatchCrawlTask()` — create task first, then build command with `--session-id ${task._id}`, update prompt
- [ ] Refactor `createCommentCrawlTask()` — same pattern
- [ ] Refactor `createCrawlTask()` — same pattern
- [ ] Run `npx tsc --noEmit` to verify no type errors

## Success Criteria

- Each task's `prompt` field contains `--session-id <mongodb-objectid>`
- No shared session between tasks
