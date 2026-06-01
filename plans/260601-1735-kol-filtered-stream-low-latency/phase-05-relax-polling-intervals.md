# Phase 05 — Relax Tier S/A Polling Intervals

**Spec:** [spec.md](./spec.md) | **Plan:** [plan.md](./plan.md)

## Overview

- **Priority:** P2
- **Status:** Completed
- **Effort:** 0.5h

Since stream is now the primary detection mechanism for Tier S/A, polling intervals can be relaxed. Polling becomes a fallback for stream gaps/disconnects.

## Key Insights

- Current defaults in `KolSettings.ts`: Tier S = 30min, Tier A = 120min
- New defaults: Tier S = 120min, Tier A = 240min
- These are **default values** in the schema — existing DB documents with custom values are unaffected
- A migration script is NOT needed — `getSettings()` singleton will use new defaults only if no document exists yet, or if the field is missing

## Related Code Files

- **Modify:** `src/db/models/KolSettings.ts` — update `ITierCrawlIntervals` default values

## Implementation Steps

1. In `KolSettings.ts`, find the `tier_crawl_intervals` schema defaults:
   ```typescript
   // Before
   s: { type: Number, default: 30 },
   a: { type: Number, default: 120 },
   
   // After
   s: { type: Number, default: 120 },
   a: { type: Number, default: 240 },
   ```

2. If existing DB document has old values (30/120), operator should manually update via `PATCH /api/kol-settings` with:
   ```json
   { "tier_crawl_intervals": { "s": 120, "a": 240 } }
   ```
   Document this in the phase notes — no automated migration needed.

## Todo List

- [x] Update Tier S default from 30 → 120 in `KolSettings.ts`
- [x] Update Tier A default from 120 → 240 in `KolSettings.ts`
- [x] Run `npm run build` — confirm no compile errors
- [x] Note: operator must manually update existing DB settings document

## Success Criteria

- New default values reflect stream-as-primary strategy
- Build passes
- Existing settings document update documented for operator

## Next Steps

- After deploying, operator runs: `PATCH /api/kol-settings` to update live intervals
