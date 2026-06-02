# Phase 1 — KolSettings Schema Additions

## Context Links
- Current model: `src/db/models/KolSettings.ts`
- Migration template: `src/scripts/migrateKolSettingsTierIntervals.ts`
- Route whitelist: `src/routes/kolSettings.ts:171-198`

## Overview
- **Priority**: P1 (blocker for Phase 2/3)
- **Status**: pending
- **Description**: Add `prime_window` and `tier_batch_intervals` sub-schemas to `KolSettings` with validation, defaults, and a one-shot migration script.

## Requirements

### Functional
1. `prime_window: { start_hour: number, end_hour: number }` — defaults `{ start_hour: 9, end_hour: 13 }`.
2. `tier_batch_intervals: { A: number, B: number, C: number }` — defaults `120, 180, 240` (minutes).
3. `tier_crawl_intervals.S` should remain at 15 min (used as the **prime-mode API poll interval**; off-prime, Tier S is batched using `tier_batch_intervals.S` if we set it, but per user spec, Tier S in off-prime uses 2h — the same as A. Document this in the schedule note).
4. Migration script is idempotent: re-running on an already-migrated doc is a no-op (logs and exits).
5. Route `PATCH /api/kol-settings` accepts updates to the new fields with clamping.

### Non-functional
- All new fields use Mongoose `min`/`max` validators at the schema layer.
- No breaking change to existing fields; defaults populate transparently.

## Architecture

### Schema additions (`src/db/models/KolSettings.ts`)

```typescript
export interface IPrimeWindow {
  start_hour: number;  // 0-23, server-local
  end_hour: number;    // 1-24, > start_hour
}

const primeWindowSchema = new Schema<IPrimeWindow>(
  {
    start_hour: { type: Number, default: 9, min: 0, max: 23 },
    end_hour:   { type: Number, default: 13, min: 1, max: 24 },
  },
  { _id: false },
);

export interface ITierBatchIntervals {
  A: number;  // minutes, >= 5
  B: number;  // >= 30
  C: number;  // >= 30
}

const tierBatchIntervalsSchema = new Schema<ITierBatchIntervals>(
  {
    A: { type: Number, default: 120, min: 5  },
    B: { type: Number, default: 180, min: 30 },
    C: { type: Number, default: 240, min: 60 },
  },
  { _id: false },
);
```

Add both to the main `IKolSettings` interface and to the schema definition:
```typescript
prime_window: { type: primeWindowSchema, default: () => ({}) },
tier_batch_intervals: { type: tierBatchIntervalsSchema, default: () => ({}) },
```

Also **lower** `tier_crawl_intervals.S` default from 120 → 15 to match the new prime-mode behavior:
```typescript
S: { type: Number, default: 15, min: 5 },  // was 120
```

### Validation helper
Add a module-level helper `isWithinPrimeWindow(pw: IPrimeWindow, now: Date): boolean`:
- Treats `end_hour` as **exclusive** (window is `[start_hour, end_hour)`).
- If `start_hour < end_hour` (normal case, e.g. 9..13): `now.getHours() >= start && now.getHours() < end`.
- If `start_hour > end_hour` (wrap-around midnight, e.g. 22..2): `(now.getHours() >= start) || (now.getHours() < end)`.
- If equal, return `false` (empty window — log a warning).
- Unit-test this helper (see Phase 5).

### Route changes (`src/routes/kolSettings.ts`)
- Add `prime_window` and `tier_batch_intervals` to the `GET /` response (lines 17-31).
- Add `prime_window` and `tier_batch_intervals` to the `PATCH /` `allowedTopLevel` (line 102) and clamp `start_hour` 0..23, `end_hour` 1..24, batch intervals per the same per-tier minimums.
- Add validation: if `end_hour <= start_hour` (and not midnight-wrap-around), return 400.
- Include the two new fields in the `PATCH /` response (line 204).

### Migration script (`src/scripts/migrateKolSettingsPrimeWindow.ts`)
Mirror `migrateKolSettingsTierIntervals.ts`:
- Connect, `findOne()`, log if none.
- Check if `prime_window` and `tier_batch_intervals` already present (truthy with all required keys) → log and exit 0.
- Otherwise `$set` the defaults via `KolSettings.updateOne`.
- Disconnect, exit 0/1.

Add to `package.json` scripts:
```json
"migrate:kol-settings-prime-window": "tsx src/scripts/migrateKolSettingsPrimeWindow.ts"
```

## Related Code Files

### Modify
- `src/db/models/KolSettings.ts` — add schemas, fields, lower `S` default.
- `src/routes/kolSettings.ts` — extend GET response, PATCH whitelist, validation.
- `package.json` — add migration script.

### Create
- `src/scripts/migrateKolSettingsPrimeWindow.ts` — one-shot migration.

## Implementation Steps

1. Edit `KolSettings.ts`: add `IPrimeWindow` + `primeWindowSchema`, `ITierBatchIntervals` + `tierBatchIntervalsSchema`, add to main interface + schema, lower `S` default.
2. Add `isWithinPrimeWindow()` export from `KolSettings.ts` (or `src/utils/prime-window.ts` if file-size concerns — file is currently 180 lines, OK to add).
3. Edit `src/routes/kolSettings.ts`: extend GET response, extend PATCH whitelist, add validation.
4. Create `migrateKolSettingsPrimeWindow.ts` modeled after the existing one.
5. Add npm script `migrate:kol-settings-prime-window`.
6. Run `npm run typecheck` — must pass.

## Todo List
- [ ] Schema additions written
- [ ] isWithinPrimeWindow helper implemented
- [ ] Route whitelist updated
- [ ] Migration script written
- [ ] npm script added
- [ ] typecheck passes

## Success Criteria
- `KolSettings.getSettings()` returns a doc with all four new fields populated (no `undefined`).
- Migration script is idempotent (running twice produces the same result).
- `PATCH /api/kol-settings` with `{ "prime_window": { "start_hour": 8, "end_hour": 12 } }` persists.
- `PATCH` with invalid values returns 400.

## Risk Assessment
- **Low risk**: additive schema change with defaults. Existing code that doesn't read the new fields is unaffected.
- **Mid risk**: changing the `S` default from 120 → 15 changes the meaning of `tier_crawl_intervals.S`. The only current consumer is `crawlDueKols()` (which we'll remove) and the migration script. Document in the plan and CHANGELOG.

## Security Considerations
None — this is internal config, not user-facing auth.

## Next Steps
- Phase 2: `createBatchCrawlTasks()` reads `tier_batch_intervals` to decide batch cadence.
- Phase 3: `executePrimePolling` reads `prime_window` to decide whether to fire.
