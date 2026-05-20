---
status: pending
spec: ./spec.md
---

# OpenClaw Session Isolation

Prevent context window overflow by isolating each openclaw task into its own session, with automatic cleanup of old session files.

## Phases

| # | Phase | Status | Files |
|---|-------|--------|-------|
| 1 | [Add --session-id to task commands](./phase-01-session-id.md) | pending | `src/services/kolCrawlerService.ts` |
| 2 | [Add session cleanup cron](./phase-02-session-cleanup.md) | pending | `src/scripts/kolDaemon.ts` |

## Dependencies

None. Both phases are independent and can be done in any order.
