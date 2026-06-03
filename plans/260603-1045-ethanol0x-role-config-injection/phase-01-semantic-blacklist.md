# Phase 01 — Add Semantic Blacklist to Skip Rules

**Status:** completed  
**File:** `src/utils/kolPostSkipRules.ts`

## Context

`kolPostSkipRules.ts` already has `shouldSkipPost()` for structural rules (retweet, CA, DEX domains, cashtag). We need a second function `shouldSkipBySemantics()` for keyword-based safety filtering from the `@ethanol0x` spec.

## Related Files

- `src/utils/kolPostSkipRules.ts` — modify
- `src/tests/kolPostSkipRules.test.ts` — does not exist yet, created in Phase 4

## Implementation Steps

1. Open `src/utils/kolPostSkipRules.ts`

2. Add after the existing regex constants at top of file:

```typescript
// AFK semantic blacklist — keywords that indicate unsafe-to-auto-reply posts
export const AFK_SEMANTIC_BLACKLIST = [
  "died", "passed away", "rip", "r.i.p",
  "hack", "hacked", "exploit", "drained",
  "rug", "rugged", "scam", "exit scam",
  "lawsuit", "sue", "sued", "arrested", "investigation",
] as const;

const SEMANTIC_BLACKLIST_RE = new RegExp(
  AFK_SEMANTIC_BLACKLIST.map((w) => `\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).join("|"),
  "i",
);
```

3. Add after `shouldSkipPost()`:

```typescript
/**
 * Returns true if post content contains AFK-unsafe keywords.
 * Called before reply generation to avoid LLM cost on sensitive posts.
 * Applies regardless of KOL tier.
 */
export function shouldSkipBySemantics(content: string): boolean {
  return SEMANTIC_BLACKLIST_RE.test(content);
}
```

## Notes

- Regex escape added for multi-word entries like "passed away", "exit scam", "r.i.p" — the `\b` word boundary works correctly around spaces in multi-word phrases
- "r.i.p" needs `.` escaped → `r\.i\.p` — the escape function handles this
- `as const` on the array enables typed iteration in tests

## Todo

- [x] Add `AFK_SEMANTIC_BLACKLIST` constant
- [x] Add `SEMANTIC_BLACKLIST_RE` regex
- [x] Add `shouldSkipBySemantics()` function
- [x] Run compile check: `npx tsc --noEmit`
