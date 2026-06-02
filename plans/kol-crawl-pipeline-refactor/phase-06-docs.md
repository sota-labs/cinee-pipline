# Phase 6 — Docs

## Context Links
- `docs/system-architecture.md:305-330` — current KOL Crawl → Analyze → Reply workflow (mentions stream worker)
- `docs/codebase-summary.md:107` — cron jobs table (mentions stream worker)
- `docs/code-standards.md` — directory structure tree (lists `kolStreamService`)
- New note: `docs/notes/prime-window-and-batch-schedule.md`

## Overview
- **Priority**: P3
- **Status**: pending
- **Description**: Update the three existing doc files to reflect the new architecture (no stream, new schedule), and add a short rationale note explaining the schedule decisions.

## Requirements

### Functional

1. **`docs/system-architecture.md`**:
   - Replace the "KOL Crawl → Analyze → Reply" workflow section (lines 305-330):
     - Remove "Tier S/A posts are captured real-time by kolStreamWorker (X Filtered Stream)".
     - Replace with the new 4-job schedule table (see Phase 3).
     - Add a brief note that the prime window is interpreted in server-local time.
   - Update the "Data Models → KOL Models Schema" section if it lists stream-specific fields (read once more; if no fields, no change).

2. **`docs/codebase-summary.md`**:
   - **Update "Last Updated"** to 2026-06-02.
   - Update the cron jobs table (line 107):
     - Remove the "tier S/A via stream worker" note.
     - Add the new schedule (prime + 4 batch crons).
   - Update the services list — add `kolScheduleService` to the 12 services count → 13.
   - Remove `kolStreamService` from the services list (already not listed — verify).
   - Update the directory structure tree if it lists `kolStreamService` (it doesn't, but the scripts list may include `kolStreamWorker.ts` — verify and remove).

3. **`docs/code-standards.md`**:
   - The directory tree in lines 14-99 includes `scripts/` with `kolDaemon.ts` — verify the list is up to date (no `kolStreamWorker.ts` mentioned — good).
   - Add a short "Cron Scheduling Patterns" subsection:
     - Always use server-local time unless `TZ` env var is set.
     - Use mutexes (`isXxxRunning`) for cron handlers that may overlap.
     - Document the prime-window pattern.

4. **`docs/notes/prime-window-and-batch-schedule.md`** (new file):
   - **Why we dropped the stream**: budget (Pro tier not affordable); Pay-Per-Use tier doesn't support Filtered Stream.
   - **Why prime window for Tier S**: highest-value KOLs deserve the lowest-latency path that doesn't burn browser automation; X API + prime window is the right cost-quality trade.
   - **Why batch for everyone else**: OpenClaw browser automation is expensive in time + compute, but doesn't burn X API quota; batching at 2h/3h/4h is acceptable for lower tiers.
   - **Schedule table** (copy from Phase 3).
   - **Open questions**: timezone assumption, future Redis-lock for multi-instance.
   - **Migration note**: run `npm run migrate:kol-settings-prime-window` after deploying Phase 1.

5. **CHANGELOG** (if `docs/project-changelog.md` exists):
   - Add a 2026-06-02 entry: "Refactor: drop X Filtered Stream; add prime-window X API poll + OpenClaw batch task schedule for KOL crawling."

### Non-functional
- Doc updates are mechanical — no new sections > 100 lines.
- No code-block examples > 30 lines (KISS).

## Architecture
N/A.

## Related Code Files

### Modify
- `docs/system-architecture.md`
- `docs/codebase-summary.md`
- `docs/code-standards.md`
- `docs/project-changelog.md` (if exists)

### Create
- `docs/notes/prime-window-and-batch-schedule.md`

## Implementation Steps

1. Read each doc file fully (already done in research).
2. Edit `system-architecture.md` workflow section.
3. Edit `codebase-summary.md` cron table + service count + Last Updated.
4. Edit `code-standards.md` to add a "Cron Scheduling Patterns" subsection.
5. Create `docs/notes/prime-window-and-batch-schedule.md`.
6. Edit `docs/project-changelog.md` if it exists.
7. Verify cross-references (e.g. roadmap links to architecture still work).

## Todo List
- [ ] system-architecture.md updated
- [ ] codebase-summary.md updated
- [ ] code-standards.md updated
- [ ] prime-window note created
- [ ] changelog entry added
- [ ] Cross-references verified

## Success Criteria
- No mention of `kolStreamService` / `kolStreamWorker` / "X Filtered Stream" in `docs/` (except the new note's "Why we dropped" section, which references the *past* architecture for context).
- Cron jobs table reflects the 4 new jobs.
- New note is < 200 lines.

## Risk Assessment
- **Low risk**: docs are not load-bearing for runtime.

## Next Steps
- Hand off to code review, then deploy.
