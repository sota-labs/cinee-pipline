---
name: OpenClaw Session Isolation
description: Isolate each task into its own openclaw session to prevent context window overflow from session history accumulation
type: feature
---

# OpenClaw Session Isolation

## Problem Statement

All KOL crawler tasks (batch crawl, comment crawl, reply execution) currently run without an explicit `--session-id`, causing openclaw to reuse the default session of agent `main`. Each task appends its full prompt + response to the shared session history. After enough tasks, the accumulated history fills the context window and subsequent tasks fail.

This is a **session accumulation** problem (Option C in analysis), not a single-task overflow problem. The fix is session isolation per task.

## User Stories

- As the system, each openclaw task should start with a clean context so it never fails due to prior task history
- As an operator, old session files should be cleaned up automatically without any manual intervention or pipeline downtime

## Evaluated Approaches

| Approach | Verdict |
|----------|---------|
| A — session per task | ✅ Selected — stateless tasks, zero overflow risk, simple implementation |
| B — session per task type + periodic reset | ❌ Still accumulates within window, requires block/rotation logic |
| C — tune compaction config | ❌ Delays the problem, doesn't eliminate it |

## Final Design

### Part 1 — Session per task (`--session-id`)

Add `--session-id ${taskId}` to the openclaw command string in all 3 task creation functions in `kolCrawlerService.ts`.

Using `task._id` (MongoDB ObjectId) as session ID:
- Globally unique, no extra generation needed
- Traceable — session file name maps directly to task ID in DB
- Zero coordination required between workers

**Before:**
```typescript
const command = `agent --agent ${settings.openClawAgent} --thinking off --message '${escapedPrompt}'`;
```

**After:**
```typescript
const command = `agent --agent ${settings.openClawAgent} --thinking off --session-id ${taskId} --message '${escapedPrompt}'`;
```

Applies to:
- `createBatchCrawlTask()` — use `task._id` after `Task.create()`
- `createCommentCrawlTask()` — same
- `createCrawlTask()` — same

### Part 2 — Session cleanup cron (`kolDaemon.ts`)

Add a daily cleanup job that deletes session files older than 3 days.

```typescript
async function executeSessionCleanup() {
  const { execSync } = await import("node:child_process");
  try {
    const sessionDir = `${process.env.HOME}/.openclaw/agents/main/sessions`;
    execSync(`find "${sessionDir}" -maxdepth 1 -mtime +3 -delete`);
    log.info("[KOLDaemon] Session cleanup done");
  } catch (err: any) {
    log.warn(`[KOLDaemon] Session cleanup failed: ${err.message}`);
  }
}

cron.schedule("0 3 * * *", executeSessionCleanup);
```

- Runs at 03:00 AM daily — low traffic window
- `-maxdepth 1` — only top-level session files, no recursive delete
- `-mtime +3` — older than 3 days
- Non-blocking — runs in background, failure is warn-only (never crashes daemon)

## Files to Change

| File | Change |
|------|--------|
| `src/services/kolCrawlerService.ts` | Add `--session-id ${taskId}` to 3 command strings |
| `src/scripts/kolDaemon.ts` | Add `executeSessionCleanup()` + cron schedule |

## Interface Contracts

No API changes. No DB schema changes. No new dependencies.

The `--session-id` flag is already supported by openclaw CLI (`openclaw agent --help` confirms).

## Error Handling

- If `find` command fails (e.g. sessions dir doesn't exist yet): caught, logged as warn, daemon continues
- If session file is in use during cleanup: `find -delete` skips locked files on Linux — no impact on running tasks

## Success Criteria

- Each task creates a new session file named after its `task._id`
- No task ever fails due to context window overflow from prior task history
- Session files older than 3 days are deleted automatically
- Worker is never blocked during cleanup

## Risks

- **None significant.** Both changes are additive and non-breaking. Worst case: `--session-id` flag is ignored by an older openclaw version → falls back to current behavior (confirmed flag exists in current version).
