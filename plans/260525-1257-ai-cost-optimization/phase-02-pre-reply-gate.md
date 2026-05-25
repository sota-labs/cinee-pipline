---
status: completed
phase: 02
blockedBy: phase-01
blocks: phase-03
completed: 2026-05-25
---

# Phase 02 — Pre-reply-gen Gate

## Context Links

- Spec: [spec.md](./spec.md#optimization-3-pre-reply-gen-gate)
- Target file: `src/services/replyEngineService.ts`

## Overview

- Priority: High (low risk, reuses existing data)
- Savings: ~$0.4/day (conservative; up to $0.78/day at 30% filter rate)
- Move virality check BEFORE Sonnet task creation; add `is_spam` + `quality_score` gates

## Key Insights

- Current flow: post → create Sonnet task → generate suggestions → `selectBestSuggestion()` checks `virality_score < 30`
- Sonnet cost ($0.026/call) is spent BEFORE the virality check fires — wasteful
- `is_spam` and `quality_score` are already parsed in `processPostAnalysisResult()` but never stored on the post model or used for filtering
- After Phase 3, merged analysis will populate `is_spam` + `quality_score` on `post.analysis` — gate reads them null-safely so Phase 2 can ship before Phase 3
- `generateSuggestions()` is the single entry point for Sonnet task creation — gate goes here

## Requirements

- Gate fires BEFORE `Task.create()` in `generateSuggestions()`
- Gate checks: `virality_score < 30` → skip; `is_spam === true` → skip; `quality_score < 40` → skip
- Skipped posts set status to `EKolPostStatus.SKIPPED`
- All gate checks null-safe (fields may not exist until Phase 3 lands)
- Log reason for skip

## Architecture

```
generateSuggestions(postId)
  → atomic status claim (ANALYZED → PENDING_REPLY)
  → shouldSkipPost() check (existing AFK skip rules)
  → passesReplyGate()   ← NEW: virality + spam + quality check
      → false: set SKIPPED, return null
      → true: continue to Task.create() + KolReplySuggestion.create()
```

## Related Code Files

- `/home/sotatek/Documents/cinee-openclaw/cinee-pipline/src/services/replyEngineService.ts`
  - `generateSuggestions()` — lines 116–220 — add gate after `shouldSkipPost()` block
  - `selectBestSuggestion()` — lines 292–308 — virality check here becomes redundant (keep as safety net)

## Implementation Steps

1. Add `passesReplyGate()` function before the `ReplyEngineService` class definition (around line 112):

```typescript
function passesReplyGate(post: { analysis?: { virality_score?: number; is_spam?: boolean; quality_score?: number } | null }): boolean {
  const analysis = post.analysis;
  if (!analysis) return false;

  if ((analysis.virality_score ?? 0) < 30) return false;
  if (analysis.is_spam === true) return false;
  if ((analysis.quality_score ?? 100) < 40) return false;

  return true;
}
```

2. In `generateSuggestions()`, after the `shouldSkipPost()` block (after line ~153), add the gate check:

```typescript
    // Pre-reply gate: check virality, spam, quality before spending Sonnet budget
    if (!passesReplyGate(post)) {
      await KolPost.findByIdAndUpdate(post._id, { status: EKolPostStatus.SKIPPED });
      log.info(
        `[ReplyEngine] Post ${post._id} failed reply gate ` +
        `(virality=${post.analysis?.virality_score ?? 'n/a'}, ` +
        `spam=${post.analysis?.is_spam ?? 'n/a'}, ` +
        `quality=${post.analysis?.quality_score ?? 'n/a'})`,
      );
      return null;
    }
```

3. Note: `post.analysis` type on `IKolPost` currently only has `{ summary, sentiment, trending_topics, virality_score }`. After Phase 3, `is_spam` and `quality_score` will be added to the model. For now, cast or use type assertion to access them:

```typescript
const analysisExt = post.analysis as (typeof post.analysis & { is_spam?: boolean; quality_score?: number }) | null;
```

Update `passesReplyGate()` to accept `IKolPost` directly and use the cast internally.

4. The virality check in `selectBestSuggestion()` (line 305) remains as a safety net — do NOT remove it.

5. Run `npm run typecheck` — fix any type errors from the extended analysis access.

## Todo List

- [x] Add `passesReplyGate()` function with null-safe checks
- [x] Insert gate call in `generateSuggestions()` after `shouldSkipPost()` block
- [x] Add log message with virality/spam/quality values on skip
- [x] Handle `is_spam`/`quality_score` type extension on `post.analysis` (cast or interface extension)
- [x] Keep existing virality check in `selectBestSuggestion()` as safety net
- [x] Run `npm run typecheck` — fix all errors

## Success Criteria

- Posts with `virality_score < 30` are skipped before Sonnet task creation
- Posts with `is_spam = true` are skipped (once Phase 3 populates the field)
- Posts with `quality_score < 40` are skipped (once Phase 3 populates the field)
- Skipped posts have status `SKIPPED` in DB
- Log shows reason for each skip
- No TypeScript errors

## Risk Assessment

- **False positives:** Gate may skip posts that would have generated good replies. Monitor `SKIPPED` post count. If too aggressive, raise `quality_score` threshold from 40 to 30.
- **Null safety:** `is_spam` and `quality_score` don't exist on `post.analysis` until Phase 3 — null-safe defaults (`?? 100` for quality, `=== true` for spam) ensure no posts are incorrectly skipped before Phase 3 lands.
- **Type safety:** `IKolPost.analysis` schema may need updating — use type cast until Phase 3 extends the model.

## Next Steps

After this phase: implement Phase 3 (merge analysis prompts + Minimax swap) — which will populate `is_spam` and `quality_score` fields that this gate uses.
