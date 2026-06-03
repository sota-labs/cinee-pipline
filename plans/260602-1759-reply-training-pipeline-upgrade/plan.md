---
title: "Reply Training Pipeline Upgrade (4 Phases)"
description: "Auto-learn, inject learned profile, eval log, RAG few-shot for the bot reply training loop"
status: pending
priority: P2
effort: ~14h
branch: main
tags: [reply, training, learning, evaluation, rag, prompt-engineering]
created: 2026-06-02
---

# Reply Training Pipeline Upgrade

**Date:** 2026-06-02
**Branch:** main
**Status:** Pending
**Progress:** 0%

---

## Goal

Close the feedback loop on the bot's reply generation. Today the bot learns the CEO's voice from a manual daily cron (`ownAccountLearnCron`) but that cron is **never wired to anything** — it lives in `src/scripts/` and is not registered in `kolDaemon` or `schedulerService`. Even when it runs, the learned profile is **not actually injected** into the CEO self-reply prompt (`buildReplyPrompt` in `promptBuilder.ts:217-261` only reads `role`, not `effective_profile`). And there is no measurement of whether learning is helping or hurting.

---

## Phases

| # | Phase | Status | Files |
|---|-------|--------|-------|
| 0 | [Clean Up PersonaKnowledge Dead Code](./phase-00-cleanup-dead-code.md) | Pending | `src/db/models/PersonaKnowledge.ts` (delete), `src/db/index.ts`, `src/routes/tools.ts` |
| 1 | [Auto-Learn Hook](./phase-01-auto-learn.md) | Pending | `src/services/ownAccountService.ts`, `src/scripts/autoLearnCron.ts` (new), `src/scripts/kolDaemon.ts`, `src/db/models/Post.ts`, `src/db/models/OwnAccountProfile.ts` |
| 2 | [Inject Learned Profile into CEO Self-Reply](./phase-02-inject-learned-profile.md) | Pending | `src/prompts/promptBuilder.ts`, `src/services/schedulerService.ts`, `src/prompts/schedulerServiceImports.ts` (new) |
| 3 | [Eval Log Collection](./phase-03-eval-log.md) | Pending | `src/db/models/ReplyEvalLog.ts` (new), `src/services/replyEvalService.ts` (new), `src/services/replyEngineService.ts`, `src/services/selfReplyService.ts`, `src/routes/replyEval.ts` (new) |
| 4a | [RAG Few-Shot via BM25](./phase-04-rag-few-shot.md) | Pending | `src/tools/memoryTools.ts` (fill in), `src/services/replyMemoryService.ts` (new), `src/prompts/kolPrompts.ts`, `src/services/replyEngineService.ts`, `src/services/selfReplyService.ts` |

---

## Key Dependencies

- **Phase 1 blocks Phase 2** — without automatic learning, the learned profile stays stale and the Phase 2 injection would inject a stale or empty profile.
- **Phase 2 blocks Phase 3** — eval needs the prompt+output pair. Output is only meaningful after Phase 2 wires `effective_profile` into the prompt. (Phase 3 can be developed in parallel but should not produce data before Phase 2 lands.)
- **Phase 3 must precede Phase 4** — RAG is an optimization, not a fix. We need the eval log to prove whether RAG actually helps before investing in vector infrastructure. If edit_ratio doesn't drop after Phase 4 ships, the few-shot injection is adding noise.
- **All phases are non-breaking** — each adds a new optional behavior, gated by config flag. Existing cron jobs continue to run.

---

## Codebase Facts (Investigation Results)

These are the answers to the 5 investigative questions in the request:

1. **Post timestamp fields**: `Post` model has **no `post_published_at` or `posted_at`**. Only `status` (POSTED), `created_at`/`updated_at` (Mongoose timestamps), `scheduled_at` (optional). The +24h delay must be computed from `updated_at` (set when status flips to POSTED) — see Phase 1.

2. **POSTED transitions**: Three places flip `status` to `POSTED`:
   - `src/telegram/kolTelegramBotNative.ts:885` — admin confirms a seed-post (Telegram "save" button).
   - `src/services/ownAccountCrawlerService.ts:159, 192` — bulk seed of own X posts (`npm run own-account:seed-posts`).
   - `src/services/scanAndPostCron.ts` (via `Task` workers; result not yet inspected but `Post.status` is set to `POSTED` after successful scan-and-post).
   - **Phase 1 should hook at the database level** (post-save hook on `Post`) rather than threading the call through 3 separate code paths.

3. **Embedding infrastructure**: **None.** Redis (`src/db/redis.ts`) is ioredis-backed and used only for caching/rate-limiting. No vector index, no embedding model client. **Phase 4 (RAG) requires new infrastructure** — flagged as a risk with a BM25 alternative.

4. **Cron registration**: The script entry `src/scripts/ownAccountLearnCron.ts` exists, with an `npm run cron:add:own-account-learn` package.json hook — but it is **not registered** in any active daemon. `kolDaemon.ts` schedules crawl/analyze/reply/AFK but **not learning**. `schedulerService.buildCronJobs()` only registers `scrape_x_notifications`. Phase 1 must add a tick inside `kolDaemon` (preferred — single source of truth) or add the registration to `registerIsolatedJobs()`.

5. **Active cron state** (the user asked us to confirm):
   - `schedulerService.buildCronJobs()` — only `scrape_x_notifications` (every hour at :20) is active. All reply/draft/research/interact/auto-like/bookmark jobs are commented out.
   - `kolDaemon.ts` — 9 active cron ticks: prime polling (S tier), batch crawl S+A, B, C, analyze (every minute), AFK replies (every 10 min), auto-reject (every 10 min), self-replies (every 2 min), session cleanup.
   - `ownAccountLearnCron.ts` — script exists, **not in any daemon**, must be manually invoked.

---

## Researcher Report

No separate researcher phase — this plan was built by directly reading the codebase. If the user wants a dedicated researcher agent to validate unknowns (see "Unresolved Questions" in each phase), spawn a `researcher` task after this plan is approved.

---

---

## Implementation Order

0 → 1 → 2 → 3 → 4a. Each phase is independently shippable behind a feature flag. Phase 0 is ~1h cleanup that reduces confusion before the substantive work begins.

### Confirmed Decisions (2026-06-02)

- **Phase 4 stack**: BM25 via MongoDB `$text` index. No embeddings, no new infrastructure.
- **Dead code**: Phase 0 deletes `PersonaKnowledge` model + 2 `/api/tools/db/persona` routes. MongoDB collection is left intact (manual drop is a separate decision).
- **Phase 2 autonomy**: Wire prompt injection only. `reply_x_notifications` cron stays commented out. No autonomous CEO replies until user unblocks.
- **Post migration**: No backfill. `learning_eligible_at` is set only on new POSTED transitions. Old posts are never learned from.
