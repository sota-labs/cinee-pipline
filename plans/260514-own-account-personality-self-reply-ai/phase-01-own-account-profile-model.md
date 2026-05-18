# Phase 01 — OwnAccountProfile Mongoose Model

**Priority:** Critical (blocks all other phases)
**Status:** Pending

---

## Context Links

- Researcher report: `plans/reports/researcher-own-account-personality.md`
- Reference model: `src/db/models/KolProfile.ts` (personality sub-doc pattern)
- Reference model: `src/db/models/KolSettings.ts` (singleton pattern via `findOne` + `create`)

---

## Overview

Create a dedicated Mongoose model for the CEO's own account personality. Unlike `KolProfile` (one doc per KOL), this is a **singleton** — one document per system, upserted by a fixed key `"own_account"`.

The model has three sub-documents:
- `manual_config` — admin-set overrides (always applied as baseline)
- `learned_profile` — AI-derived from own posts (applied when confidence ≥ 60)
- `effective_profile` — merged result used by prompts at runtime

---

## Requirements

- TypeScript interfaces for all sub-documents and the main document
- No `any` types — use `unknown` + narrowing in service layer
- Singleton upsert by fixed key `"own_account"`
- `learning_confidence` field (0–100) gates whether learned values override manual
- `slang_words` always union-merged (manual + learned, deduplicated)
- `last_learned_at` and `posts_analyzed` track learning history

---

## File to Create

**`src/db/models/OwnAccountProfile.ts`** (~120 lines)

---

## Implementation Steps

### 1. Define sub-document interfaces and schemas

```typescript
// Manual config — admin-controlled baseline
export interface IOwnAccountManualConfig {
  writing_style: string;
  slang_words: string[];
  emoji_pattern: string;
  sentence_structure: string;
  engagement_tone: string;
  avg_post_length: number;
}

// Learned profile — AI-derived from own posts
export interface IOwnAccountLearnedProfile {
  writing_style: string;
  slang_words: string[];
  emoji_pattern: string;
  sentence_structure: string;
  engagement_tone: string;
  avg_post_length: number;
  last_learned_at: Date | null;
  posts_analyzed: number;
  learning_confidence: number; // 0–100
}

// Effective profile — merged result used at runtime
export interface IOwnAccountEffectiveProfile {
  writing_style: string;
  slang_words: string[];
  emoji_pattern: string;
  sentence_structure: string;
  engagement_tone: string;
  avg_post_length: number;
}
```

All three schemas use `{ _id: false }`.

Default values for string fields: `""`. Default for arrays: `[]`. Default for numbers: `0`.

### 2. Define main document interface

```typescript
export interface IOwnAccountProfile extends Document {
  _key: string;                              // fixed "own_account" — singleton discriminator
  manual_config: IOwnAccountManualConfig;
  learned_profile: IOwnAccountLearnedProfile;
  effective_profile: IOwnAccountEffectiveProfile;
  created_at: Date;
  updated_at: Date;
}
```

### 3. Define main schema

```typescript
const ownAccountProfileSchema = new Schema<IOwnAccountProfile>(
  {
    _key: {
      type: String,
      required: true,
      unique: true,
      default: "own_account",
    },
    manual_config: { type: manualConfigSchema, default: () => ({}) },
    learned_profile: { type: learnedProfileSchema, default: () => ({}) },
    effective_profile: { type: effectiveProfileSchema, default: () => ({}) },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);
```

### 4. Add index

```typescript
ownAccountProfileSchema.index({ _key: 1 }, { unique: true });
```

### 5. Export model

```typescript
export const OwnAccountProfile = model<IOwnAccountProfile>(
  "OwnAccountProfile",
  ownAccountProfileSchema,
);
```

---

## Todo List

- [ ] Create `src/db/models/OwnAccountProfile.ts`
- [ ] Define `IOwnAccountManualConfig` interface + schema
- [ ] Define `IOwnAccountLearnedProfile` interface + schema (includes `last_learned_at`, `posts_analyzed`, `learning_confidence`)
- [ ] Define `IOwnAccountEffectiveProfile` interface + schema
- [ ] Define `IOwnAccountProfile` main interface + schema with `_key` singleton field
- [ ] Add unique index on `_key`
- [ ] Export model and all interfaces
- [ ] Verify file stays under 200 lines

---

## Success Criteria

- File compiles with `tsc --noEmit`
- `OwnAccountProfile.findOne({ _key: "own_account" })` returns typed document
- All three sub-document types are exported and importable by service layer

---

## Risk Assessment

- **Low risk** — pure model definition, no external dependencies
- `_key` field name avoids collision with Mongoose's internal `_id`

---

## Next Steps

Phase 02 imports `OwnAccountProfile` and all interfaces from this file.
