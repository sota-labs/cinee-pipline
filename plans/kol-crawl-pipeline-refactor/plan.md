---
title: "KOL Crawl Pipeline Refactor — Drop Stream, Add Prime Window + Batch Tasks"
description: "Replace X Filtered Stream with a hybrid X-API prime-window + OpenClaw batch schedule for Tier S/A/B/C, retaining rate-limit-safe parallelism."
status: pending
priority: P1
effort: 8h
branch: main
tags: [refactor, kol-crawl, openclaw, prime-window, tier-s, migration]
created: 2026-06-02
---

# KOL Crawl Pipeline Refactor

## Goal
Drop the X Filtered Stream (Pro tier not in budget) and replace it with a hybrid schedule:
- **Tier S**: X API polling every 15 min during a configurable 4h "prime window"; OpenClaw batch every 2h the rest of the day.
- **Tier A**: OpenClaw batch every 2h, all day.
- **Tier B**: OpenClaw batch every 3h.
- **Tier C**: OpenClaw batch every 4h.

## Phases

| # | Phase | Status | Effort | File |
|---|-------|--------|--------|------|
| 1 | KolSettings schema additions (prime_window, tier_batch_intervals) + migration | pending | 1.5h | [phase-01-kol-settings-schema.md](./phase-01-kol-settings-schema.md) |
| 2 | `createBatchCrawlTasks()` — OpenClaw batch task factory | pending | 2.0h | [phase-02-openclaw-batch-tasks.md](./phase-02-openclaw-batch-tasks.md) |
| 3 | `kolDaemon.ts` schedule refactor (prime + batch cron) | pending | 1.5h | [phase-03-kol-daemon-schedule.md](./phase-03-kol-daemon-schedule.md) |
| 4 | Remove stream mechanism (delete files, scrub imports) | pending | 1.0h | [phase-04-remove-stream.md](./phase-04-remove-stream.md) |
| 5 | Tests — drop stream tests, add prime-window + batch tests | pending | 1.5h | [phase-05-tests.md](./phase-05-tests.md) |
| 6 | Docs — architecture, summary, standards, schedule note | pending | 0.5h | [phase-06-docs.md](./phase-06-docs.md) |

## Key Research Findings (from scout pass)

1. **Stream worker is a sidecar process** (`kolStreamWorker.ts` + `kolStreamService.ts` + `xStreamTypes.ts`) — it's a separate npm script `stream:kol` started independently of `kol:daemon`. Removing it does not affect the daemon.

2. **`crawlDueKols()` already has solid KOL selection** (active + trust score + tier interval cutoff + pLimit concurrency + rate-limit short-circuit). The same selection logic must be reused by the new `createBatchCrawlTasks()` — only the execution path changes (Task record vs. direct X API call).

3. **`processBatchCrawlResult()` already accepts batch results** keyed by handle with `sinceByHandle`. The webhook in `routes/tasks.ts:296-310` already calls it when `payload.action === "batch_crawl"`. The end-to-end batch path is **wired and functional** — we just need to *generate* the tasks, not invent a new pipeline.

4. **OpenClaw task pattern** is well-established (`ownAccountCrawlerService.ts:84-95`, `kolAnalyzerService.ts:62-71`): `Task.create({ type: ETaskType.SINGLE_TASK_TRIGGER | CRON_JOB_TRIGGER, agent: settings.openClawAgent, prompt: "<agent cli command>", payload: {...} })`.

5. **Existing migration pattern** (`migrateKolSettingsTierIntervals.ts`) — one-shot script that backfills a sub-doc on the singleton `KolSettings` doc, idempotent, run via npm. We add a sibling `migrateKolSettingsPrimeWindow.ts`.

6. **`kolSettings.ts` route** already does whitelist-clamp updates for `tier_crawl_intervals`. We'll extend it to also expose `prime_window` and `tier_batch_intervals`.

## Key Dependencies

- `pLimit` (already a dep) — used to throttle Task creation, mirroring `crawlDueKols` parallelism.
- `node-cron` (already a dep) — used by `kolDaemon` to schedule the four cron jobs.
- `kolCrawlScript.ts` `buildTweetScript(since)` — used to embed the `since` timestamp into the agent's page.evaluate script (reused from `ownAccountCrawlerService`).

## Open Questions / Risks

1. **OpenClaw batch reliability** — every 2h a Task is queued, and a single Task covers one KOL (not multiple) to keep `handle_group` granularity. If cinee-worker is down for >1 cycle, posts from the gap window will still be caught (next cycle uses `last_crawled_at` cutoff in X API) — but the OpenClaw path doesn't have a server-side `since` cutoff, so **stale posts may be re-fetched and dropped by `processCrawlResults` via duplicate `post_url` + 2h `MAX_CRAWL_WINDOW_MS` guard**. The guard exists; the cost is wasted OpenClaw compute. Acceptable.

2. **Prime window timezone** — Server runs **UTC**. `prime_window` is stored as UTC hours. To target 09:00–13:00 ICT (UTC+7), configure `{ start_hour: 2, end_hour: 6 }`. **Decision (confirmed by user 2026-06-02): server TZ = UTC, store UTC hours, document the assumption in `docs/notes/prime-window-and-batch-schedule.md`.** See phase-01 open question.

3. **X API rate limit during prime** — 15-min polling × ~few dozen Tier S KOLs × 1 GET /users/:id/tweets call per KOL. Pay-Per-Use allows 1,500 reads/month on the user timeline endpoint (or similar). With ~25 Tier S KOLs and 16 calls/day = 400 calls/day, we're safely within quota. Document this in the schedule note.

## Success Criteria

- [ ] No `kolStream*` or `xStream*` file remains in `src/`.
- [ ] `package.json` has no `stream:kol` script.
- [ ] `npm run typecheck` passes.
- [ ] `npm run test` passes (with updated tests).
- [ ] `kolDaemon` runs four cron jobs (15min prime, 2h S+A, 3h B, 4h C) and existing analyze/AFK/self-reply/auto-reject/session-cleanup schedules are unchanged.
- [ ] `KolSettings.getSettings()` returns a doc with `prime_window` and `tier_batch_intervals` populated.
- [ ] Migration script backfills existing KolSettings docs without error.
- [ ] Updated docs reflect new architecture and schedule.

## Effort Total
~8 hours (1 dev day).
