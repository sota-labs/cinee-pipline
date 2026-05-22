# Phase 01 — Remove KolProfile Personality Model

## Context Links
- Source file: `src/db/models/KolProfile.ts`
- Related plan: `plan.md`

## Overview

**Priority:** High (blocks phases 2 and 4)  
**Status:** Pending  
**Description:** Remove the `IPersonalityProfile` interface, `ISlangExample` interface, `personalityProfileSchema` sub-schema, and the `personality_profile` field from `IKolProfile` and `kolProfileSchema`.

## Key Insights

- `personality_profile` is a sub-document using a dedicated `personalityProfileSchema` (lines 22-37).
- The field is declared in `IKolProfile` at line 53 and in `kolProfileSchema` at lines 87-90.
- `ISlangExample` (lines 6-9) is only used by `IPersonalityProfile` — remove it too.
- No indexes reference `personality_profile` — the two existing indexes (lines 108-109) are unaffected.
- MongoDB will silently ignore the orphaned `personality_profile` field in existing documents; no migration script is needed.

## Requirements

- Remove all personality-related TypeScript types and Mongoose schema definitions.
- Keep all other fields, indexes, and exports intact.
- The file must compile cleanly after the edit.

## Related Code Files

- **Modify:** `src/db/models/KolProfile.ts`

## Implementation Steps

1. **Delete lines 4-37** — the entire "Personality Profile Sub-document" section:
   ```typescript
   // DELETE this entire block (lines 4-37):
   // ── Personality Profile Sub-document ────────────────────────────────────────────

   export interface ISlangExample {
     word: string;
     context: string;
   }

   export interface IPersonalityProfile {
     writing_style: string;
     common_topics: string[];
     slang_words: string[];
     slang_examples: ISlangExample[];
     emoji_pattern: string;
     sentence_structure: string;
     engagement_tone: string;
     avg_post_length: number;
   }

   const personalityProfileSchema = new Schema<IPersonalityProfile>(
     {
       writing_style: { type: String, default: "" },
       common_topics: { type: [String], default: [] },
       slang_words: { type: [String], default: [] },
       slang_examples: {
         type: [{ word: { type: String }, context: { type: String } }],
         default: [],
       },
       emoji_pattern: { type: String, default: "" },
       sentence_structure: { type: String, default: "" },
       engagement_tone: { type: String, default: "" },
       avg_post_length: { type: Number, default: 0 },
     },
     { _id: false },
   );
   ```

2. **Delete line 53** from `IKolProfile` interface:
   ```typescript
   // DELETE this line:
   personality_profile: IPersonalityProfile;
   ```

3. **Delete lines 87-90** from `kolProfileSchema`:
   ```typescript
   // DELETE this block:
   personality_profile: {
     type: personalityProfileSchema,
     default: () => ({}),
   },
   ```

4. Run `npx tsc --noEmit` to confirm no compile errors.

## Todo

- [ ] Delete `ISlangExample` interface (lines 6-9)
- [ ] Delete `IPersonalityProfile` interface (lines 11-20)
- [ ] Delete `personalityProfileSchema` const (lines 22-37)
- [ ] Delete `personality_profile` from `IKolProfile` interface (line 53)
- [ ] Delete `personality_profile` from `kolProfileSchema` (lines 87-90)
- [ ] Verify compile passes

## Success Criteria

- `KolProfile.ts` compiles without errors.
- `IKolProfile` no longer has a `personality_profile` property.
- No other model file imports `IPersonalityProfile` or `ISlangExample`.

## Risk Assessment

- **Low risk.** MongoDB stores the field in existing documents but TypeScript will no longer expose it. No data loss — the field just becomes invisible to the application.
- If any other file imports `IPersonalityProfile` or `ISlangExample` directly, the compiler will catch it immediately.
