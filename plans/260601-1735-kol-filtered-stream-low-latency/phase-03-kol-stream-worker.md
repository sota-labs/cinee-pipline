# Phase 03 — Implement kolStreamWorker Script

**Spec:** [spec.md](./spec.md) | **Plan:** [plan.md](./plan.md)

## Overview

- **Priority:** P1
- **Status:** Completed
- **Effort:** 1.5h
- **Blocked by:** Phase 02

Standalone process entry point that wires together DB, stream service, and the analyze/reply pipeline. Follows the same pattern as `kolDaemon.ts`.

## Key Insights

- Pattern: follow `kolDaemon.ts` — connect DB/Redis, run jobs, handle SIGTERM/SIGINT
- Event handler must be non-blocking: wrap in `setImmediate` or fire-and-forget with error catch so one slow post doesn't block stream reading
- Periodic rule sync (every 6h) catches KOL tier changes made while worker is running
- `analyzePendingPosts()` and `generateSuggestions()` are already safe to call immediately — they use atomic `findOneAndUpdate` to prevent duplicate queuing

## Requirements

- Connect MongoDB + Redis on startup
- Load all active Tier S/A KOLs, build `kolIdMap`
- Call `syncRules()` then `connect()`
- On each stream post: call `processCrawlResults()` → `analyzePendingPosts()` → `generateSuggestions()`
- Schedule periodic full rule sync every 6h
- Graceful shutdown on SIGTERM/SIGINT: `disconnect()` → close DB/Redis
- Add `stream:kol` npm script in `package.json`

## Related Code Files

- **Create:** `src/scripts/kolStreamWorker.ts`
- **Modify:** `package.json` — add `"stream:kol"` script
- **Read (reuse):** `src/scripts/kolDaemon.ts` — startup/shutdown pattern
- **Read (reuse):** `src/services/kolCrawlerService.ts` — `processCrawlResults()`
- **Read (reuse):** `src/services/kolAnalyzerService.ts` — `analyzePendingPosts()`
- **Read (reuse):** `src/services/replyEngineService.ts` — `generateSuggestions()`

## Implementation Steps

1. Create `src/scripts/kolStreamWorker.ts`:

```typescript
import { connectDB } from '../db/connection.js';
import { connectRedis } from '../db/redis.js';
import { KolProfile } from '../db/models/KolProfile.js';
import { EKolTier } from '../db/models/KolProfile.js';
import { connect, disconnect, syncRules } from '../services/kolStreamService.js';
import { processCrawlResults } from '../services/kolCrawlerService.js';
import { analyzePendingPosts } from '../services/kolAnalyzerService.js';
import { generateSuggestions } from '../services/replyEngineService.js';
import { logger } from '../utils/logger.js';

async function loadStreamKols() {
  return KolProfile.find({ is_active: true, tier: { $in: [EKolTier.S, EKolTier.A] } }).lean();
}

async function main() {
  await connectDB();
  await connectRedis();

  const kols = await loadStreamKols();
  const kolIdMap = new Map(kols.filter(k => k.x_user_id).map(k => [k.x_user_id!, String(k._id)]));

  await syncRules(kols);

  await connect(async (rawPost, kolId) => {
    // Fire-and-forget with error isolation — don't block stream reader
    setImmediate(async () => {
      try {
        await processCrawlResults([rawPost], kolId);
        await analyzePendingPosts();
        await generateSuggestions();
      } catch (err) {
        logger.error('Stream post pipeline error', { kolId, error: err });
      }
    });
  }, kolIdMap);

  // Periodic rule sync every 6h
  setInterval(async () => {
    try {
      const refreshed = await loadStreamKols();
      await syncRules(refreshed);
    } catch (err) {
      logger.error('Periodic rule sync failed', { error: err });
    }
  }, 6 * 60 * 60 * 1000);

  logger.info('KOL stream worker started', { kolCount: kols.length });
}

async function shutdown() {
  logger.info('KOL stream worker shutting down');
  disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch(err => {
  logger.error('KOL stream worker fatal error', { error: err });
  process.exit(1);
});
```

2. Add to `package.json` scripts:
   ```json
   "stream:kol": "node --loader ts-node/esm src/scripts/kolStreamWorker.ts"
   ```
   (Match the exact run pattern used by `kolDaemon.ts` in package.json)

## Todo List

- [x] Create `src/scripts/kolStreamWorker.ts`
- [x] Wire `processCrawlResults()` → `analyzePendingPosts()` → `generateSuggestions()` in event handler
- [x] Add `setImmediate` wrapper for non-blocking event handling
- [x] Add periodic 6h rule sync with `setInterval`
- [x] Add SIGTERM/SIGINT handlers
- [x] Add `stream:kol` script to `package.json`
- [x] Run `npm run build` — confirm no compile errors

## Success Criteria

- Worker starts, syncs rules, connects stream without errors
- Stream events trigger pipeline without blocking stream reader
- Worker shuts down cleanly on SIGTERM
- `npm run stream:kol` launches the worker

## Risk Assessment

- **`processCrawlResults()` signature:** Verify exact parameters — may need `kolId` as ObjectId not string; check existing callers in `kolCrawlerService.ts`
- **`analyzePendingPosts()` / `generateSuggestions()` scope:** These process ALL pending posts, not just the one just received — this is correct behavior (batch processing), but confirm they don't have unintended side effects when called frequently
