# Plan: Self-Reply Trigger — End-to-End Wire-Up

**Created:** 2026-05-18
**Status:** Pending

## Goal

Wire the self-reply flow end-to-end so that when someone comments on our own X post, the system automatically creates a `SelfReplyQueue`, generates an AI reply via OpenClaw, and either auto-sends (AFK) or notifies via Telegram (Manual). Also adds a `/seed` Telegram command for manually seeding posts into DB.

## Spec Reference

`plans/reports/spec-260518-self-reply-trigger.md`

## Phases

| # | Phase | Status | Files Owned |
|---|-------|--------|-------------|
| 1 | Reply model + SCRAPE_PROMPT | Pending | `src/db/models/Reply.ts`, `src/services/schedulerPrompts.ts` |
| 2 | tools.ts route trigger | Pending | `src/routes/tools.ts` |
| 3 | selfReplyService completion | Pending | `src/services/selfReplyService.ts`, `src/routes/tasks.ts` |
| 4 | Telegram manual mode | Pending | `src/telegram/kolTelegramBotNative.ts`, `src/services/selfReplyService.ts` |
| 5 | /seed Telegram command | Pending | `src/telegram/kolTelegramBotNative.ts` |

## Dependencies

- Phase 1 must complete before Phase 2 (route reads new Reply fields)
- Phase 3 must complete before Phase 4 (Telegram calls `sendReply()`)
- Phase 4 and Phase 5 both own `kolTelegramBotNative.ts` — must run sequentially
- Phase 5 depends on Phase 4 completing first

## Key Constraints

- `kolTelegramBotNative.ts` is 661 lines. After Phase 4+5 additions it will approach ~850 lines. Acceptable — splitting would add more complexity than it saves (KISS).
- No new cron jobs. No new API routes beyond what's in spec.
- `parseXUrl()` helper goes in `src/routes/tools.ts` (local to the file, not exported).
- `buildExecuteReplyPrompt()` is a new builder in `src/prompts/kolPrompts.ts` — owned by Phase 3.
