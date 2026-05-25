---
status: completed
phase: 03
blockedBy: phase-02
blocks: phase-04
completed: 2026-05-25
---

# Phase 03 — Merge Analysis Prompts + Minimax Swap

## Context Links

- Spec: [spec.md](./spec.md#optimization-2-merge-analysis-calls--swap-to-minimax)
- Target files: `src/prompts/kolPrompts.ts`, `src/services/kolAnalyzerService.ts`, `src/config/settings.ts`

## Overview

- Priority: Medium (requires prompt engineering + model config change)
- Savings: ~$1.01/day ($1.04 → $0.03/day on analysis)
- Merge `POST_ANALYSIS_PROMPT` + `COMMENT_PATTERN_PROMPT` into one `MERGED_ANALYSIS_PROMPT`
- Swap analysis model from Sonnet to Minimax
- Update `kolAnalyzerService` to create 1 task instead of 2
- Update `applyAnalysisResults()` to parse merged output into both `analysis` + `engagement_pattern` fields

## Key Insights

- Current: 2 Sonnet calls/post × $0.026 = $0.052/post × 20 posts = $1.04/day
- New: 1 Minimax call/post × $0.0015 = $0.0015/post × 20 posts = $0.03/day
- `openClawAnalysisModel` already exists in `settings.ts` (line 216) — currently `openrouter/anthropic/claude-sonnet-4.6`
- `queueAnalysisTask()` already accepts a `model` param (line 53) — just pass `settings.openClawAnalysisModel`
- Currently `queueAnalysisTask()` is called WITHOUT a model (passes `undefined`) — model flag is omitted from command
- `applyAnalysisResults()` currently takes separate `IAnalysisResult` + `IEngagementPattern` params — keep signature, parse merged output into both
- `is_spam` and `quality_score` are parsed in `processPostAnalysisResult()` but NOT stored on `post.analysis` — Phase 3 must store them so Phase 2 gate can use them
- Need to update `IKolPost` model's `analysis` subdocument schema to include `is_spam` + `quality_score`

## Requirements

- `MERGED_ANALYSIS_PROMPT` returns all fields from both existing prompts in one JSON object
- `openClawAnalysisModel` env var points to Minimax model string
- `queuePostAnalysis()` creates 1 task (not 2), passes `settings.openClawAnalysisModel` as model
- `applyAnalysisResults()` parses merged JSON into `analysis` + `engagement_pattern` fields
- `post.analysis` stores `is_spam` + `quality_score` (for Phase 2 gate)
- `processPostAnalysisResult()` updated to return `is_spam` + `quality_score` in `IAnalysisResult`
- Old `buildPostAnalysisPrompt()` + `buildCommentPatternPrompt()` kept (don't delete — may be used elsewhere)

## Architecture

```
queuePostAnalysis(post)
  → buildMergedAnalysisPrompt()     ← NEW builder
  → queueAnalysisTask("merged_analysis", prompt, postId, settings.openClawAnalysisModel)
  → 1 Task created (was 2)

applyAnalysisResults(postId, mergedResult)
  → parseMergedAnalysisResult()     ← NEW parser
  → post.analysis = { summary, sentiment, trending_topics, virality_score, is_spam, quality_score }
  → post.engagement_pattern = { dominant_tone, common_phrases, emoji_trend, question_ratio }
```

## Related Code Files

- `/home/sotatek/Documents/cinee-openclaw/cinee-pipline/src/prompts/kolPrompts.ts`
  - Add `MERGED_ANALYSIS_PROMPT` constant (after line 61)
  - Add `buildMergedAnalysisPrompt()` function
  - Keep existing `POST_ANALYSIS_PROMPT`, `COMMENT_PATTERN_PROMPT`, their builders

- `/home/sotatek/Documents/cinee-openclaw/cinee-pipline/src/services/kolAnalyzerService.ts`
  - `IAnalysisResult` interface (line 21) — add `isSpam` + `qualityScore` fields
  - `queuePostAnalysis()` (line 194) — replace 2 task creations with 1
  - `processPostAnalysisResult()` (line 85) — update to return `isSpam` + `qualityScore`
  - `applyAnalysisResults()` (line 254) — store `is_spam` + `quality_score` on `post.analysis`
  - Update import: add `buildMergedAnalysisPrompt`, remove `buildPostAnalysisPrompt` + `buildCommentPatternPrompt` from active use

- `/home/sotatek/Documents/cinee-openclaw/cinee-pipline/src/config/settings.ts`
  - `openClawAnalysisModel` default value (line 216) — change to Minimax model string

- `/home/sotatek/Documents/cinee-openclaw/cinee-pipline/src/db/models/KolPost.ts` (check schema)
  - `analysis` subdocument — add `is_spam: Boolean` + `quality_score: Number` fields

## Implementation Steps

1. **`src/config/settings.ts`** — update `openClawAnalysisModel` default:

```typescript
openClawAnalysisModel:
  process.env.OPENCLAW_ANALYSIS_MODEL ||
  "openrouter/minimax/minimax-m2.5",
```

2. **`src/prompts/kolPrompts.ts`** — add `MERGED_ANALYSIS_PROMPT` after line 61:

```typescript
export const MERGED_ANALYSIS_PROMPT = `Analyze this social media post and its comments in one pass.

POST CONTENT:
{{post_content}}

ENGAGEMENT METRICS:
- Likes: {{likes}}
- Comments: {{comments}}
- Retweets: {{retweets}}
- Views: {{views}}

TOP COMMENTS:
{{top_comments}}

Your task:
1. Write a concise 2-3 sentence summary of the post
2. Determine the sentiment (positive/negative/neutral)
3. Identify up to 3 trending topics mentioned
4. Calculate a virality score (0-100) based on engagement rate
5. Quick safety check: detect spam or low-quality content
6. Give a quality score (0-100) for reply-worthiness
7. Identify the dominant comment tone (humor/agreement/debate/curiosity/questions)
8. Extract common phrases/slangs from comments
9. Note emoji patterns frequently used in comments
10. Calculate the percentage of comments that are questions

Respond in this exact JSON format:
{
  "summary": "...",
  "sentiment": "positive|negative|neutral",
  "trending_topics": ["topic1", "topic2"],
  "virality_score": 75,
  "is_spam": false,
  "quality_score": 85,
  "dominant_tone": "humor|agreement|debate|curiosity|questions",
  "common_phrases": ["phrase1", "phrase2"],
  "emoji_trend": ["emoji1", "emoji2"],
  "question_ratio": 0.3
}
${OUTPUT_FORMAT_INSTRUCTION}`;
```

3. **`src/prompts/kolPrompts.ts`** — add `buildMergedAnalysisPrompt()` function:

```typescript
export function buildMergedAnalysisPrompt(params: {
  postContent: string;
  likes: number;
  comments: number;
  retweets: number;
  views: number;
  topComments: Array<{ content: string; author_handle: string; likes: number }>;
}): string {
  const formatted = params.topComments.length > 0
    ? params.topComments
        .map((c, i) => `${i + 1}. @${c.author_handle}: "${c.content}" (${c.likes} likes)`)
        .join("\n")
    : "(no comments)";

  return MERGED_ANALYSIS_PROMPT
    .replace("{{post_content}}", params.postContent)
    .replace("{{likes}}", String(params.likes))
    .replace("{{comments}}", String(params.comments))
    .replace("{{retweets}}", String(params.retweets))
    .replace("{{views}}", String(params.views))
    .replace("{{top_comments}}", formatted);
}
```

4. **`src/services/kolAnalyzerService.ts`** — update `IAnalysisResult` interface:

```typescript
export interface IAnalysisResult {
  summary: string;
  sentiment: ESentiment;
  trendingTopics: string[];
  viralityScore: number;
  isSpam: boolean;
  qualityScore: number;
}
```

5. **`src/services/kolAnalyzerService.ts`** — update imports to add `buildMergedAnalysisPrompt`:

```typescript
import {
  buildMergedAnalysisPrompt,
} from "../prompts/kolPrompts.js";
```

6. **`src/services/kolAnalyzerService.ts`** — replace `queuePostAnalysis()` body (lines 194–249). Replace the 2-task creation block with 1 merged task:

```typescript
  async queuePostAnalysis(post: IKolPost): Promise<string[]> {
    const claimed = await KolPost.findOneAndUpdate(
      { _id: post._id, status: EKolPostStatus.NEW },
      { $set: { status: EKolPostStatus.ANALYZING } },
    );
    if (!claimed) {
      log.info(`[KolAnalyzer] Post ${post._id} already claimed for analysis — skipping`);
      return [];
    }

    const kol = await KolProfile.findById(post.kol_id).select("tier handle").lean();
    const priority = kol ? tierToPriority(kol.tier) : 0;
    const handleGroup = kol?.handle ?? null;

    const mergedPrompt = buildMergedAnalysisPrompt({
      postContent: post.content,
      likes: post.likes,
      comments: post.comments,
      retweets: post.retweets,
      views: post.views,
      topComments: post.top_comments,
    });

    const taskId = await queueAnalysisTask(
      "post_analysis",
      mergedPrompt,
      String(post._id),
      settings.openClawAnalysisModel,
      priority,
      handleGroup,
    );

    log.info(`[KolAnalyzer] Queued merged analysis task for post ${post._id}`);
    return [taskId];
  }
```

7. **`src/services/kolAnalyzerService.ts`** — update `processPostAnalysisResult()` to return `isSpam` + `qualityScore`:

In the return statement (around line 115), add:
```typescript
  return {
    summary: parsed.summary,
    sentiment,
    trendingTopics: parsed.trending_topics || [],
    viralityScore: Math.max(0, Math.min(100, parsed.virality_score || 0)),
    isSpam: parsed.is_spam ?? false,
    qualityScore: Math.max(0, Math.min(100, parsed.quality_score ?? 100)),
  };
```

8. **`src/services/kolAnalyzerService.ts`** — update `applyAnalysisResults()` to store `is_spam` + `quality_score`:

```typescript
    post.analysis = {
      summary: analysis.summary,
      sentiment: analysis.sentiment,
      trending_topics: analysis.trendingTopics,
      virality_score: analysis.viralityScore,
      is_spam: analysis.isSpam,
      quality_score: analysis.qualityScore,
    };
```

9. **`src/db/models/KolPost.ts`** — read the file, then add `is_spam` + `quality_score` to the `analysis` subdocument schema. Example:

```typescript
is_spam: { type: Boolean, default: false },
quality_score: { type: Number, default: 100 },
```

Also update the TypeScript interface for `analysis` to include these fields.

10. Run `npm run typecheck` — fix all errors. Common issues: `IAnalysisResult` callers that don't pass `isSpam`/`qualityScore`, `post.analysis` type mismatch.

## Todo List

- [x] Update `openClawAnalysisModel` default in `settings.ts` to Minimax
- [x] Add `MERGED_ANALYSIS_PROMPT` constant to `kolPrompts.ts`
- [x] Add `buildMergedAnalysisPrompt()` function to `kolPrompts.ts`
- [x] Update `IAnalysisResult` interface — add `isSpam` + `qualityScore`
- [x] Update imports in `kolAnalyzerService.ts`
- [x] Replace 2-task creation in `queuePostAnalysis()` with 1 merged task
- [x] Update `processPostAnalysisResult()` to return `isSpam` + `qualityScore`
- [x] Update `applyAnalysisResults()` to store `is_spam` + `quality_score` on post
- [x] Read `KolPost.ts` model — add `is_spam` + `quality_score` to analysis subdocument schema + interface
- [x] Run `npm run typecheck` — fix all errors

## Success Criteria

- `queuePostAnalysis()` creates exactly 1 Task per post (not 2)
- Task command includes `--model openrouter/minimax/minimax-m2.5` (or env override)
- `post.analysis.is_spam` + `post.analysis.quality_score` populated after analysis
- `processCommentPatternResult()` still works (kept for backward compat with any existing tasks in flight)
- No TypeScript errors

## Risk Assessment

- **Quality degradation:** Minimax may produce lower-quality analysis than Sonnet. Monitor `virality_score` distribution after switch. If scores drift significantly, tune prompt or revert `openClawAnalysisModel` env var.
- **Merged prompt complexity:** Single prompt doing 10 tasks may produce less reliable JSON. Add explicit JSON-only instruction. Test with sample posts before deploying.
- **In-flight tasks:** During deploy, some posts may have `post_analysis` + `comment_pattern` tasks already queued. `processCommentPatternResult()` must remain functional to handle them.
- **Model availability:** Verify `openrouter/minimax/minimax-m2.5` is the correct model ID on OpenRouter before deploying.

## Next Steps

After this phase: implement Phase 4 (prompt caching for author voice block) — verify OpenRouter `cache_control` support first.
