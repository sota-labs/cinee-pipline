# Phase 02 — Remove Learning Service Methods

## Context Links
- Source file: `src/services/kolAnalyzerService.ts`
- Related plan: `plan.md`
- Depends on: `phase-01-remove-kol-personality-model.md`

## Overview

**Priority:** High  
**Status:** Pending  
**Description:** Remove all personality-learning methods and types from `KolAnalyzerService`, and remove the `"personality"` type from the `queueAnalysisTask` union type. Keep all post-analysis and comment-pattern methods intact.

## Key Insights

- `IPersonalityUpdate` interface (lines 37-46) is only used by `learnPersonality` and `applyPersonalityUpdate` — remove it.
- The `IAnalysisTaskResult.type` union at line 51 includes `"personality"` — remove that literal.
- `buildPersonalityLearningPrompt` is imported at line 14 — remove that import.
- `queueAnalysisTask` itself is kept (still used for `post_analysis` and `comment_pattern`).
- `processPersonalityResult` (lines 159-194) is a standalone exported function — remove it.
- Three class methods to remove: `learnPersonality` (lines 324-359), `applyPersonalityUpdate` (lines 364-386), `runDailyPersonalityLearning` (lines 391-413).

## Requirements

- Remove personality-specific types, imports, exported function, and class methods.
- Keep `processPostAnalysisResult`, `processCommentPatternResult`, `analyzePendingPosts`, `queuePostAnalysis`, `applyAnalysisResults`, `getPendingAnalysisTasks`, and `queueAnalysisTask`.
- File must compile cleanly after edits.

## Related Code Files

- **Modify:** `src/services/kolAnalyzerService.ts`

## Implementation Steps

1. **Line 14** — Remove `buildPersonalityLearningPrompt` from the import:
   ```typescript
   // BEFORE (line 14):
   import {
     buildPostAnalysisPrompt,
     buildCommentPatternPrompt,
     buildPersonalityLearningPrompt,
   } from "../prompts/kolPrompts.js";

   // AFTER:
   import {
     buildPostAnalysisPrompt,
     buildCommentPatternPrompt,
   } from "../prompts/kolPrompts.js";
   ```

2. **Lines 37-46** — Delete `IPersonalityUpdate` interface:
   ```typescript
   // DELETE:
   export interface IPersonalityUpdate {
     writingStyle: string;
     commonTopics: string[];
     slangWords: string[];
     slangExamples: Array<{ word: string; context: string }>;
     emojiPattern: string;
     sentenceStructure: string;
     engagementTone: string;
     avgPostLength: number;
   }
   ```

3. **Line 51** — Remove `"personality"` from the `IAnalysisTaskResult.type` union:
   ```typescript
   // BEFORE:
   type: "post_analysis" | "comment_pattern" | "personality";

   // AFTER:
   type: "post_analysis" | "comment_pattern";
   ```

4. **Lines 159-194** — Delete the exported `processPersonalityResult` function entirely:
   ```typescript
   // DELETE this entire function:
   export async function processPersonalityResult(
     kolId: string,
     rawResult: string,
   ): Promise<IPersonalityUpdate | null> { ... }
   ```

5. **Lines 324-359** — Delete `learnPersonality` method from the class:
   ```typescript
   // DELETE:
   async learnPersonality(kolId: string | Types.ObjectId): Promise<boolean> { ... }
   ```

6. **Lines 364-386** — Delete `applyPersonalityUpdate` method from the class:
   ```typescript
   // DELETE:
   async applyPersonalityUpdate(
     kolId: string,
     update: IPersonalityUpdate,
   ): Promise<void> { ... }
   ```

7. **Lines 391-413** — Delete `runDailyPersonalityLearning` method from the class:
   ```typescript
   // DELETE:
   async runDailyPersonalityLearning(): Promise<{
     processed: number;
     failed: number;
   }> { ... }
   ```

8. Check if `Types` import (line 18) is still needed. It was used by `learnPersonality(kolId: string | Types.ObjectId)`. After removal, verify no remaining method uses `Types` — if not, remove the import line too.

9. Run `npx tsc --noEmit` to confirm no compile errors.

## Todo

- [ ] Remove `buildPersonalityLearningPrompt` from import (line 14)
- [ ] Delete `IPersonalityUpdate` interface (lines 37-46)
- [ ] Remove `"personality"` from `IAnalysisTaskResult.type` union (line 51)
- [ ] Delete `processPersonalityResult` exported function (lines 159-194)
- [ ] Delete `learnPersonality` class method (lines 324-359)
- [ ] Delete `applyPersonalityUpdate` class method (lines 364-386)
- [ ] Delete `runDailyPersonalityLearning` class method (lines 391-413)
- [ ] Remove `Types` import if no longer used (line 18)
- [ ] Verify compile passes

## Success Criteria

- `kolAnalyzerService.ts` compiles without errors.
- `kolAnalyzerService` singleton no longer exposes `learnPersonality`, `applyPersonalityUpdate`, or `runDailyPersonalityLearning`.
- `processPersonalityResult` is no longer exported from this module.

## Risk Assessment

- **Low risk.** These methods are only called from `replyEngineService.ts` (guard block — removed in phase 4), `kolDaemon.ts` (removed in phase 3), and `tasks.ts` (removed in phase 3). Removing them before those callers are cleaned up will cause compile errors — complete phases 3 and 4 promptly after this phase.
