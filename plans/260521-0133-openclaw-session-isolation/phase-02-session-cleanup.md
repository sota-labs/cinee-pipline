# Phase 2 — Add session cleanup cron

**Status:** pending
**File:** `src/scripts/kolDaemon.ts`

## Context

With session-per-task, session files accumulate at `~/.openclaw/agents/main/sessions/`. Need daily cleanup of files older than 3 days to prevent unbounded disk growth.

## Implementation Steps

### 1. Add `executeSessionCleanup()` function

Add after `executeDailyLearning()`:

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
```

### 2. Register cron schedule

Add after the `executeDailyLearning` cron line:

```typescript
// Clean up openclaw session files older than 3 days at 03:00 AM
cron.schedule("0 3 * * *", executeSessionCleanup);
```

### 3. Add to `--run-now` block (optional)

Do NOT add to the `RUN_NOW` block — cleanup on startup is unnecessary and could delete sessions from tasks still being processed.

## Todo

- [ ] Add `executeSessionCleanup()` function to `kolDaemon.ts`
- [ ] Register `cron.schedule("0 3 * * *", executeSessionCleanup)`
- [ ] Run `npx tsc --noEmit` to verify no type errors

## Success Criteria

- Cron fires at 03:00 AM daily
- Session files older than 3 days are deleted
- Daemon does not crash if sessions directory is missing or empty
- Worker is never blocked during cleanup
