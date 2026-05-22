# Phase 01 — KolSettings Schema: Add `ITierCrawlIntervals`

## Overview

- **Priority:** High (blocks phases 2 and 3)
- **Status:** Completed
- **Description:** Add the `ITierCrawlIntervals` interface and `tier_crawl_intervals` sub-document field to `KolSettings`. This is the single source of truth for per-tier crawl frequency.

## Related Code Files

- **Modify:** `src/db/models/KolSettings.ts`

## Key Insights

- `KolSettings.ts` is 159 lines. All sub-document interfaces follow the same pattern: TypeScript interface → Mongoose sub-schema → field on `IKolSettings` → field on `kolSettingsSchema`.
- The existing `crawl_interval_minutes` field (line 98, 127) is the legacy flat interval. It stays in place — `tier_crawl_intervals` is additive.
- The `getSettings()` singleton (lines 149–155) requires no changes; it returns the full document including the new field automatically.

## Implementation Steps

1. **After line 91** (end of `safetySettingsSchema` block, before `// ── Main Interface`), insert the new interface and sub-schema:

```typescript
export interface ITierCrawlIntervals {
  S: number; // minutes, default 30
  A: number; // minutes, default 120
  B: number; // minutes, default 240
  C: number; // minutes, default 480
}

const tierCrawlIntervalsSchema = new Schema<ITierCrawlIntervals>(
  {
    S: { type: Number, default: 30,  min: 5  },
    A: { type: Number, default: 120, min: 30 },
    B: { type: Number, default: 240, min: 60 },
    C: { type: Number, default: 480, min: 60 },
  },
  { _id: false },
);
```

2. **In `IKolSettings` interface** (lines 95–111), add the new field after `safety: ISafetySettings;` (line 108):

```typescript
tier_crawl_intervals: ITierCrawlIntervals;
```

3. **In `kolSettingsSchema`** (lines 119–145), add the new field after the `safety` field entry (line 140):

```typescript
tier_crawl_intervals: { type: tierCrawlIntervalsSchema, default: () => ({}) },
```

## Todo

- [x] Insert `ITierCrawlIntervals` interface and `tierCrawlIntervalsSchema` after line 91
- [x] Add `tier_crawl_intervals: ITierCrawlIntervals` to `IKolSettings` interface (after line 108)
- [x] Add `tier_crawl_intervals` field to `kolSettingsSchema` (after line 140)
- [x] Run `tsc --noEmit` to verify no compile errors

## Success Criteria

- `tsc --noEmit` passes with zero errors
- `KolSettings.getSettings()` returns a document with `tier_crawl_intervals: { S: 30, A: 120, B: 240, C: 480 }` on first creation
- Existing fields (`crawl_interval_minutes`, `safety`, etc.) are unaffected

## Risk Assessment

- **Low risk.** Purely additive schema change. Existing documents without the field will use Mongoose defaults on next read.
- No migration script needed — Mongoose applies defaults lazily on `getSettings()` → `create({})`.
