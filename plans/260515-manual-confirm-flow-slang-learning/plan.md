# Plan: Manual Mode Confirm Flow + KOL Slang Learning

**Date:** 2026-05-15
**Branch:** chore/improve-kol-crawl
**Status:** Pending
**Progress:** 0%

---

## Overview

Two improvements to the KOL engagement system:

1. **Enhanced Manual Mode** — Instead of showing all 3 suggestions and waiting for user to pick, the system pre-selects the best suggestion (using AFK intelligence) and sends a quick confirm/reject to Telegram. Auto-rejects after 1 hour if no response.

2. **KOL Slang Learning** — Extract slang with usage context from KOL posts, then inject a "slang dictionary" into reply generation prompts so AI replies use slang naturally.

AFK mode stays unchanged.

---

## Phases

| # | Phase | Status | Files |
|---|-------|--------|-------|
| 1 | [Manual Confirm Flow — Model + Settings](./phase-01-manual-confirm-settings.md) | Pending | `src/db/models/KolSettings.ts` |
| 2 | [Manual Confirm Flow — Service Logic](./phase-02-manual-confirm-service.md) | Pending | `src/services/replyEngineService.ts` |
| 3 | [Manual Confirm Flow — Telegram Bot](./phase-03-manual-confirm-telegram.md) | Pending | `src/telegram/kolTelegramBotNative.ts` |
| 4 | [Manual Confirm Flow — Auto-Reject Cron](./phase-04-auto-reject-cron.md) | Pending | `src/scripts/kolAutoRejectCron.ts` |
| 5 | [KOL Slang Learning — Model + Prompts](./phase-05-slang-learning.md) | Pending | `src/db/models/KolProfile.ts`, `src/prompts/kolPrompts.ts`, `src/services/kolAnalyzerService.ts`, `src/services/replyEngineService.ts` |

---

## Key Dependencies

- Phase 1 → Phase 2 (service uses new settings field)
- Phase 2 → Phase 3 (Telegram bot calls new service method)
- Phase 2 → Phase 4 (cron uses `runAutoRejectExpired()`)
- Phase 5 is independent, can run in parallel with Phase 3/4

---

## Mode Behavior Summary

| | AFK | Manual (new) |
|---|-----|------|
| Selection | Auto-select best | Auto-select best |
| Execution | Auto-execute after delay | Wait for Telegram confirm |
| Timeout | N/A | Auto-reject after 1 hour |
| Fallback | Convert to manual if low confidence | Show full list via "See All" |
