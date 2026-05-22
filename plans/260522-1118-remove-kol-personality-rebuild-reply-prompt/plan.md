# Plan: Remove KOL Personality Learning & Rebuild Reply Prompt

**Created:** 2026-05-22  
**Status:** Pending

## Objective

Remove the KOL personality learning flow entirely and rebuild the reply generation prompt to use already-crawled post data (analysis + top_comments) instead of the `personality_profile` fields.

## Phases

| # | Phase | Status | File(s) |
|---|-------|--------|---------|
| 1 | [Remove KolProfile personality model](./phase-01-remove-kol-personality-model.md) | Pending | `src/db/models/KolProfile.ts` |
| 2 | [Remove learning service methods](./phase-02-remove-learning-service-methods.md) | Pending | `src/services/kolAnalyzerService.ts` |
| 3 | [Remove daemon cron + routes](./phase-03-remove-daemon-and-routes.md) | Pending | `src/scripts/kolDaemon.ts`, `src/routes/tasks.ts`, `src/routes/kols.ts` |
| 4 | [Rebuild reply prompt + call site](./phase-04-rebuild-reply-prompt.md) | Pending | `src/prompts/kolPrompts.ts`, `src/services/replyEngineService.ts` |

## Key Dependencies

- Phase 1 must complete before Phase 2 (service references the model type).
- Phase 2 must complete before Phase 3 (routes import service methods).
- Phase 4 is independent of phases 1-3 but should be done last to avoid a broken intermediate state where the guard is removed before the new prompt is ready.

## What is NOT touched

- `src/services/ownAccountService.ts` — own-account personality learning stays.
- `src/db/models/OwnAccountProfile.ts` — own-account model stays.
- `src/scripts/ownAccountLearnCron.ts` — own-account cron stays.
- `src/routes/account.ts` — all account routes stay.
- The `analysisType === "own_account_personality"` webhook block in `tasks.ts` stays.
