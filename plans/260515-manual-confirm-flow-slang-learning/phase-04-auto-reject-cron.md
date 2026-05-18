# Phase 04 — Auto-Reject Cron

**Priority:** Medium
**Status:** Pending

---

## Context Links

- Service method: `replyEngineService.runAutoRejectExpired()` (from Phase 2)
- Existing cron pattern: `src/scripts/kolAFKReplyCron.ts`
- Task model: `src/db/models/Task.ts`

---

## Overview

Create a cron script that runs every 10 minutes to auto-reject manual suggestions that have been pending longer than the configured timeout (default: 60 minutes).

---

## Implementation Steps

### 1. Create `src/scripts/kolAutoRejectCron.ts`

```typescript
/** Cron: Auto-reject expired manual suggestions */
import { connectDB } from "../db/connection.js";
import { replyEngineService } from "../services/replyEngineService.js";
import { log } from "../utils/logger.js";

async function main(): Promise<void> {
  await connectDB();

  log.info("[AutoRejectCron] Running...");
  const result = await replyEngineService.runAutoRejectExpired();
  log.info(`[AutoRejectCron] Done — rejected: ${result.rejected}`);

  process.exit(0);
}

main().catch((err) => {
  log.error(`[AutoRejectCron] Fatal: ${err.message}`);
  process.exit(1);
});
```

### 2. Register in cron job system

Add to the cron registration script (same pattern as existing crons):
- **Interval:** Every 10 minutes
- **Command:** `npx tsx src/scripts/kolAutoRejectCron.ts`

---

## Done When

- [ ] `src/scripts/kolAutoRejectCron.ts` created
- [ ] Script connects to DB, calls `runAutoRejectExpired()`, exits
- [ ] Registered in cron system
- [ ] `npx tsc --noEmit` passes
