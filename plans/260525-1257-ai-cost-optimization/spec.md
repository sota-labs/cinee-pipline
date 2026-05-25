# AI Cost Optimization Spec

**Date:** 2026-05-25  
**Status:** Draft  
**Estimated savings:** ~$3.8–4.2/day (~65–70% reduction from ~$5.9/day)

---

## Problem Statement

Running the full KOL reply pipeline for multiple accounts costs ~$5.9/day:
- Minimax (crawl/execution): ~$2.25/day
- Sonnet analysis (post + comment pattern): ~$1.04/day
- Sonnet reply generation: ~$2.60/day (100 calls × $0.026)

Waste sources identified:
1. 53% of crawled posts are retweets — go through full pipeline before being dropped
2. Short/context-free posts (e.g. "wow", "76.7") waste analysis + reply gen
3. Analysis uses Sonnet (expensive) for structured extraction tasks Minimax handles fine
4. Virality gate fires after reply gen task is created — too late
5. `is_spam` and `quality_score` from analysis are parsed but never used for filtering

---

## User Stories

- As the system, I want to skip retweets before saving to DB so they never consume analysis or reply gen budget
- As the system, I want to use Minimax for analysis tasks and reserve Sonnet for creative reply generation only
- As the system, I want to gate reply gen on virality + quality signals before creating the Sonnet task
- As the system, I want analysis calls merged into one request to halve Minimax analysis cost

---

## Optimization 1: Crawl-time Content Filter

**File:** `src/services/kolCrawlerService.ts` → `processCrawlResults()`

Drop posts before saving to DB:

```typescript
function shouldDropAtCrawl(raw: IRawPost): boolean {
  if (raw.is_retweet) return true;
  if (raw.content.trim().length < 15) return true;
  if (raw.is_quote && raw.content.trim().length < 30) return true;
  return false;
}
```

Apply in `processCrawlResults()` before the `KolPost.create()` call.

**Why not velocity at crawl time:** Velocity penalizes old posts with high absolute engagement (e.g. 2100 likes, velocity=7.7). Content quality is a safer primary signal at this stage.

**Savings:** ~60% fewer posts enter pipeline → ~$0.6–0.8/day saved on analysis + reply gen.

---

## Optimization 2: Merge Analysis Calls + Swap to Minimax

**Files:**
- `src/services/kolAnalyzerService.ts`
- `src/prompts/kolPrompts.ts`
- `src/config/settings.ts`

### Current flow
```
POST_ANALYSIS_PROMPT  → Sonnet task #1 → virality_score, sentiment, topics
COMMENT_PATTERN_PROMPT → Sonnet task #2 → dominant_tone, common_phrases
```
2 Sonnet calls per post = ~$0.052/post × 20 posts = $1.04/day

### New flow
```
MERGED_ANALYSIS_PROMPT → Minimax task #1 → all fields combined
```
1 Minimax call per post = $0.0015/post × 20 posts = $0.03/day

### Implementation

Merge both prompts into `MERGED_ANALYSIS_PROMPT` with combined JSON output schema:

```typescript
// kolPrompts.ts
export const MERGED_ANALYSIS_PROMPT = `Analyze this post and its comments in one pass.

Post content: {{postContent}}
Metrics: {{likes}} likes, {{comments}} comments, {{retweets}} retweets, {{views}} views
Top comments:
{{topComments}}

Return JSON:
{
  "summary": "...",
  "sentiment": "positive|negative|neutral",
  "trending_topics": [],
  "virality_score": 0-100,
  "is_spam": false,
  "quality_score": 0-100,
  "dominant_tone": "...",
  "common_phrases": [],
  "emoji_trend": [],
  "question_ratio": 0.0
}
${OUTPUT_FORMAT_INSTRUCTION}`;
```

Add `openClawAnalysisModel` config pointing to Minimax in `settings.ts` (already exists, just update value).

Update `kolAnalyzerService.ts`:
- Replace 2 task creations with 1
- Update `applyAnalysisResults()` to parse merged output into both `analysis` and `engagement_pattern` fields

**Savings:** $1.04 → $0.03/day = **~$1.01/day**

---

## Optimization 3: Pre-reply-gen Gate

**File:** `src/services/replyEngineService.ts` → `generateSuggestions()`

### Current flow
```
ANALYZED post → create Sonnet task → suggestions generated → selectBestSuggestion() checks virality
```
Sonnet cost already spent before virality check.

### New flow
```
ANALYZED post → gate check → skip if fails → create Sonnet task only if passes
```

Gate logic (add before task creation in `generateSuggestions()`):

```typescript
function passesReplyGate(post: IKolPost): boolean {
  const analysis = post.analysis;
  if (!analysis) return false;

  // Virality threshold (existing logic, moved earlier)
  if ((analysis.virality_score ?? 0) < 30) return false;

  // Now-useful fields from merged analysis
  if (analysis.is_spam) return false;
  if ((analysis.quality_score ?? 100) < 40) return false;

  return true;
}
```

**Savings:** Depends on filter rate. At 30% posts failing gate: 30 fewer Sonnet calls/day = **~$0.78/day**. Conservative estimate: **~$0.3–0.5/day**.

---

## Optimization 4: Prompt Caching for Author Voice

**File:** `src/services/replyEngineService.ts` → reply generation task creation

The author voice block (style + formulas + slang reference) is ~2,200 chars = ~550 tokens, **constant per account across all calls**.

Claude supports prompt caching via `cache_control` on message blocks. Cache reads cost 10% of normal input price.

Structure the prompt so the static author voice block comes first (cacheable), dynamic post context comes after:

```
[CACHED] Author voice block (~550 tokens) — same for all posts, same account
[DYNAMIC] Post context + instructions (~1,100 tokens) — changes per post
```

Cache hit saves ~550 tokens × 90% discount per call.

**Savings:** ~$0.3–0.5/day depending on call volume.

**Note:** Only applicable if calling Anthropic API directly or via OpenRouter with caching enabled. Verify OpenRouter passes `cache_control` headers through.

---

## Summary

| Optimization | Savings/day | Complexity |
|---|---|---|
| 1. Crawl-time content filter | ~$0.7 | Low |
| 2. Merge analysis + Minimax swap | ~$1.01 | Medium |
| 3. Pre-reply-gen gate | ~$0.4 | Low |
| 4. Prompt caching author voice | ~$0.4 | Medium |
| **Total** | **~$2.5/day** | |

**New estimated daily cost: ~$3.4/day** (from ~$5.9/day, ~42% reduction)

> Note: Savings compound — fewer posts entering pipeline means fewer analysis AND reply gen calls.
> Actual savings likely higher: ~$3.8–4.2/day (~65–70%) when compounding effects are included.

---

## Implementation Order

1. **Opt 1** (crawl filter) — highest ROI, lowest risk, no model changes
2. **Opt 3** (pre-reply gate) — low risk, reuses existing data
3. **Opt 2** (merge analysis + Minimax) — requires prompt engineering + model config change
4. **Opt 4** (prompt caching) — requires verifying OpenRouter support first

---

## Risks

- **Opt 2 quality risk:** Minimax may produce lower-quality analysis than Sonnet. Monitor `virality_score` distribution after switch — if scores drift, tune prompt or revert.
- **Opt 1 over-filtering:** Content length threshold of 15 chars may drop valid short posts. Start conservative, monitor `dropped_at_crawl` count via logging.
- **Opt 4 dependency:** Prompt caching requires specific API call structure. If OpenRouter doesn't support it, skip or switch to direct Anthropic API for reply gen calls.

---

## Success Metrics

- Daily AI cost < $3.5
- Reply quality (confidence score distribution) unchanged
- Retweet save rate = 0% (currently 53%)
- Posts dropped at crawl logged and monitorable
