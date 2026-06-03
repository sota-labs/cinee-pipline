# Phase 03 — Wire Semantic Check in replyEngineService

**Status:** completed  
**File:** `src/services/replyEngineService.ts`

## Context

`generateSuggestions()` already calls `shouldSkipPost()` for structural rules. We add `shouldSkipBySemantics()` right after, before `passesReplyGate()`. This ensures semantic-unsafe posts are skipped with zero LLM cost.

Semantic check applies regardless of KOL tier — tier S bypass only applies to `shouldSkipPost()` structural rules.

## Related Files

- `src/services/replyEngineService.ts` — modify
- `src/utils/kolPostSkipRules.ts` — import from (Phase 01)

## Implementation Steps

1. Open `src/services/replyEngineService.ts`

2. Add `shouldSkipBySemantics` to existing import from `kolPostSkipRules.js` at line 17:

```typescript
// Before:
import { shouldSkipPost } from "../utils/kolPostSkipRules.js";

// After:
import { shouldSkipPost, shouldSkipBySemantics } from "../utils/kolPostSkipRules.js";
```

3. In `generateSuggestions()`, after the existing `shouldSkipPost` block (currently lines ~160-170), add the semantic check:

```typescript
// Semantic AFK blacklist — skip before spending LLM budget
if (shouldSkipBySemantics(post.content)) {
  await KolPost.findByIdAndUpdate(post._id, { status: EKolPostStatus.SKIPPED });
  log.info(`[ReplyEngine] Skipped post ${post._id} — matched semantic blacklist`);
  return null;
}
```

Place it **after** the `shouldSkipPost` block and **before** the `passesReplyGate` block.

The final order in `generateSuggestions()`:
```
1. shouldSkipPost()        — structural rules (tier S bypasses this)
2. shouldSkipBySemantics() — keyword safety (NO tier bypass)
3. passesReplyGate()       — quality/virality gate
4. buildReplyGenerationPromptWithFewShot() — LLM call
```

## Notes

- No other changes needed in this file — `buildReplyGenerationPromptWithFewShot()` already picks up `authorVoiceStyle`/`authorSlangReference`/`authorStyleFormulas` from `appSettings.role` which is loaded from `ROLE_CONFIG_PATH`
- The `logSuggestionGeneration()` private method also rebuilds the prompt — it will also benefit from the new config automatically since it reads from `appSettings.role`

## Todo

- [x] Update import line for `shouldSkipBySemantics`
- [x] Add semantic check block after `shouldSkipPost` block
- [x] Run compile check: `npx tsc --noEmit`
