# Phase 03 — Remove Daemon Cron + Routes

## Context Links
- Source files: `src/scripts/kolDaemon.ts`, `src/routes/tasks.ts`, `src/routes/kols.ts`
- Related plan: `plan.md`
- Depends on: `phase-02-remove-learning-service-methods.md`

## Overview

**Priority:** High  
**Status:** Pending  
**Description:** Remove the `executeDailyLearning` function and its `0 2 * * *` cron schedule from `kolDaemon.ts`; remove the `analysisType === "personality"` webhook handler block from `tasks.ts`; remove the `POST /:id/learn` and `GET /:id/personality` endpoints from `kols.ts`.

## Key Insights

### kolDaemon.ts
- `executeDailyLearning` is defined at lines 75-83.
- The cron schedule is at line 126: `cron.schedule("0 2 * * *", executeDailyLearning, { timezone: "UTC" });`
- The comment on line 125 (`// Run daily personality learning at 02:00 AM`) should be removed with the schedule line.
- `kolAnalyzerService` import at line 17 is still needed for `executeAnalyze` — do NOT remove it.

### tasks.ts
- The `"personality"` handler block spans lines 156-176 (inside the `setImmediate` callback).
- The imports at lines 8-12 include `processPersonalityResult` and `kolAnalyzerService` — after removing the personality block, check if `kolAnalyzerService` is still used elsewhere in the file (it is, at line 145 for `applyAnalysisResults`). Remove only `processPersonalityResult` from the import.
- The dynamic import of `KolPost` and `EKolPostStatus` inside the personality block (lines 163-164) is only used there — it disappears with the block.

### kols.ts
- `POST /:id/learn` endpoint: lines 255-275 (including the JSDoc comment at lines 255-257).
- `GET /:id/personality` endpoint: lines 308-329 (including the JSDoc comment at lines 308-310).
- `kolAnalyzerService` is imported at line 6 and used only by `POST /:id/learn`. After removing that endpoint, remove the import.

## Requirements

- Remove only the personality-related code; leave all other cron jobs, webhook handlers, and routes intact.
- Files must compile cleanly after edits.

## Related Code Files

- **Modify:** `src/scripts/kolDaemon.ts`
- **Modify:** `src/routes/tasks.ts`
- **Modify:** `src/routes/kols.ts`

## Implementation Steps

### kolDaemon.ts

1. **Delete lines 75-83** — the `executeDailyLearning` function:
   ```typescript
   // DELETE:
   async function executeDailyLearning() {
     log.info("[KOLDaemon] Daily Personality Learning job starting…");
     try {
       const result = await kolAnalyzerService.runDailyPersonalityLearning();
       log.info(`[KOLDaemon] Daily Learning done — processed: ${result.processed}, failed: ${result.failed}`);
     } catch (err: any) {
       log.error(`[KOLDaemon] Daily Learning job crashed: ${err.message}`);
     }
   }
   ```

2. **Delete lines 125-126** — the cron schedule and its comment:
   ```typescript
   // DELETE:
   // Run daily personality learning at 02:00 AM
   cron.schedule("0 2 * * *", executeDailyLearning, { timezone: "UTC" });
   ```

### tasks.ts

3. **Line 9** — Remove `processPersonalityResult` from the import:
   ```typescript
   // BEFORE:
   import {
     processPostAnalysisResult,
     processCommentPatternResult,
     processPersonalityResult,
     kolAnalyzerService,
   } from "../services/kolAnalyzerService.js";

   // AFTER:
   import {
     processPostAnalysisResult,
     processCommentPatternResult,
     kolAnalyzerService,
   } from "../services/kolAnalyzerService.js";
   ```

4. **Delete lines 156-176** — the `analysisType === "personality"` handler block:
   ```typescript
   // DELETE this entire else-if block:
   } else if (payload.analysisType === "personality") {
     const result = await processPersonalityResult(relatedId, rawResult);
     if (result) {
       await kolAnalyzerService.applyPersonalityUpdate(relatedId, result);
       log.info(`[Webhook] Applied personality to KOL ${relatedId}`);

       // Retry suggestion generation for any posts that were waiting on this personality
       const { KolPost, EKolPostStatus } = await import("../db/models/KolPost.js");
       const waitingPosts = await KolPost.find({
         kol_id: relatedId,
         status: EKolPostStatus.ANALYZED,
         comments_crawled: true,
       });
       if (waitingPosts.length > 0) {
         log.info(`[Webhook] Retrying suggestion generation for ${waitingPosts.length} waiting post(s) of KOL ${relatedId}`);
         for (const post of waitingPosts) {
           await replyEngineService.generateSuggestions(post._id);
         }
       }
     }
   }
   ```
   The surrounding `if/else if` chain becomes: `if (post_analysis) ... else if (comment_pattern) ...` with no third branch.

### kols.ts

5. **Delete lines 255-275** — `POST /:id/learn` endpoint (including JSDoc):
   ```typescript
   // DELETE:
   /**
    * POST /api/kols/:id/learn — Trigger personality learning
    */
   router.post("/:id/learn", async (req: Request, res: Response) => {
     try {
       const kol = await KolProfile.findById(req.params.id);
       if (!kol) {
         return res.status(404).json({ error: "KOL not found" });
       }

       const success = await kolAnalyzerService.learnPersonality(String(req.params.id));

       res.json({
         message: success ? "Personality learning queued" : "Not enough posts to learn",
         data: { success },
       });
     } catch (error) {
       log.error(`[KolsRoute] Learn error: ${(error as Error).message}`);
       res.status(500).json({ error: "Failed to learn personality" });
     }
   });
   ```

6. **Delete lines 308-329** — `GET /:id/personality` endpoint (including JSDoc):
   ```typescript
   // DELETE:
   /**
    * GET /api/kols/:id/personality — Get personality profile
    */
   router.get("/:id/personality", async (req: Request, res: Response) => {
     try {
       const kol = await KolProfile.findById(req.params.id).select("handle personality_profile");

       if (!kol) {
         return res.status(404).json({ error: "KOL not found" });
       }

       res.json({
         data: {
           handle: kol.handle,
           personality: kol.personality_profile,
         },
       });
     } catch (error) {
       log.error(`[KolsRoute] Personality error: ${(error as Error).message}`);
       res.status(500).json({ error: "Failed to get personality" });
     }
   });
   ```

7. **Line 6 in kols.ts** — Remove the `kolAnalyzerService` import (no longer used):
   ```typescript
   // DELETE:
   import { kolAnalyzerService } from "../services/kolAnalyzerService.js";
   ```

8. Run `npx tsc --noEmit` to confirm no compile errors across all three files.

## Todo

- [ ] Delete `executeDailyLearning` function from `kolDaemon.ts` (lines 75-83)
- [ ] Delete `0 2 * * *` cron schedule + comment from `kolDaemon.ts` (lines 125-126)
- [ ] Remove `processPersonalityResult` from import in `tasks.ts` (line 9)
- [ ] Delete `analysisType === "personality"` handler block from `tasks.ts` (lines 156-176)
- [ ] Delete `POST /:id/learn` endpoint from `kols.ts` (lines 255-275)
- [ ] Delete `GET /:id/personality` endpoint from `kols.ts` (lines 308-329)
- [ ] Remove `kolAnalyzerService` import from `kols.ts` (line 6)
- [ ] Verify compile passes for all three files

## Success Criteria

- `kolDaemon.ts` no longer schedules a `0 2 * * *` job.
- `tasks.ts` no longer handles `analysisType === "personality"` webhooks.
- `kols.ts` no longer exposes `POST /api/kols/:id/learn` or `GET /api/kols/:id/personality`.
- All three files compile without errors.

## Risk Assessment

- **Low risk for daemon and routes.** These are isolated deletions with no downstream callers.
- **Medium risk for tasks.ts** — the `else if` chain must remain syntactically valid after removing the middle branch. Verify the surrounding `if/else if` structure is clean after the edit.
