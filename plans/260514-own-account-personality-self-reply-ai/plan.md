# Plan: Own Account Personality Learning + Self-Reply AI Integration

**Date:** 2026-05-14
**Branch:** chore/improve-kol-crawl
**Status:** Completed
**Progress:** 100%

---

## Overview

Teach the system to learn the CEO's own writing style from their posted tweets, then use that learned personality to generate authentic AI replies to comments on their own posts — replacing the current hardcoded stub in `selfReplyService.ts`.

---

## Phases

| # | Phase | Status | Files |
|---|-------|--------|-------|
| 1 | [OwnAccountProfile Model](./phase-01-own-account-profile-model.md) | Completed | `src/db/models/OwnAccountProfile.ts` |
| 2 | [Learning Service + Prompts + Cron](./phase-02-own-account-service-and-prompts.md) | Completed | `src/prompts/ownAccountPrompts.ts`, `src/services/ownAccountService.ts`, `src/scripts/ownAccountLearnCron.ts` |
| 3 | [Self-Reply AI Integration](./phase-03-self-reply-ai-integration.md) | Completed | `src/services/selfReplyService.ts`, `src/routes/tasks.ts` |
| 4 | [API Routes + App Wiring](./phase-04-api-routes-and-wiring.md) | Completed | `src/routes/account.ts`, `src/app.ts`, `src/services/replyEngineService.ts` |

---

## Key Dependencies

- Phase 1 must complete before Phase 2 (service imports the model)
- Phase 2 must complete before Phase 3 (webhook calls `ownAccountService.applyLearnedProfile`)
- Phase 3 must complete before Phase 4 (routes import updated service)
- `KolSettings.default_mode` drives AFK vs Manual for self-replies (no mode field on `SelfReplyQueue`)
- Task webhook discriminator: `payload.analysisType` (not `task.type`)
- All relative imports use `.js` extension (Node16 module resolution)

---

## Researcher Report

[researcher-own-account-personality.md](../reports/researcher-own-account-personality.md)
