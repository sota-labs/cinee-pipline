# Phase 04 — RAG Few-Shot via `memoryTools`

**Priority:** P3 (optimization, not fix)
**Status:** Pending
**Blocked by:** Phase 03 (must measure whether RAG is worth the cost)
**Blocks:** none

---

## Context Links

- Empty file: `src/tools/memoryTools.ts` (1 line, just a comment)
- Redis setup: `src/db/redis.ts` (ioredis singleton, no vector search)
- KOL reply prompt builder: `src/prompts/kolPrompts.ts:254-298` (`buildReplyGenerationPrompt`)
- Self-reply prompt builder: `src/prompts/kolPrompts.ts:300-317` (`buildSelfReplyPrompt`)
- Reply model: `src/db/models/Reply.ts` (no vector field; status `REPLIED` = past posted)
- `Reply` indexing: `src/db/models/Reply.ts:68-72` (status, platform, url, author_handle, parent_post_url)
- MongoDB version: per `package.json` (mongoose 9.3.1) — Atlas Search / `$vectorSearch` available on Atlas only

---

## Overview

The user has correctly flagged the RAG risk: vector search needs infrastructure we don't have. This phase **proposes two alternatives** and recommends the simpler one.

**Goal of RAG few-shot:** when generating a reply, find the top-K past POSTED replies most similar to the current context (KOL post, comment, or own-post thread), and inject them as in-context examples in the prompt. The hypothesis is that 3-5 concrete examples of the CEO's past replies will produce better stylistic match than abstract persona descriptions.

### The infrastructure gap

| Component | Status | Cost to add |
|-----------|--------|-------------|
| Embedding model | None | Pick model + API key + ~$0.02/1K tokens |
| Vector store | None | Atlas `$vectorSearch` (requires Atlas), or Pinecone/Weaviate (new service), or pgvector (new DB), or in-process HNSW (lost on restart) |
| Index update hook | None | Add to every POSTED transition |
| Embedding drift | Real concern | Re-embed when embedding model changes |

This is **1-2 weeks of work** and adds 2 new external dependencies. **The user is right to ask for a simpler alternative.**

### Recommendation: BM25 alternative (Phase 4a)

Skip embeddings. Use **lexical BM25** (or simpler: MongoDB full-text search with `$text` operator) over past POSTED replies. The hypothesis: replies that share words with the current context are likely stylistically similar (slang, topics, phrases). The evidence is in `Post.raw_content` text index (`src/db/models/Post.ts:131` — already exists!) — same pattern can be applied to `Reply.reply_content`.

**Trade-off:** BM25 misses semantic similarity ("based" and "fire" never co-occur, but both signal hype). Acceptable for few-shot selection because the goal is **style transfer**, not retrieval accuracy.

**Phase 4 ships in two tiers:**
- **4a (recommended, ships first):** BM25 over `Reply.reply_content` via MongoDB text index. No new infra, ~2h of work.
- **4b (optional, ship only if 4a doesn't move the needle):** Add embeddings + vector store.

---

## Requirements

- Few-shot examples come from past `Reply` records with `status: REPLIED` (posted, not drafts).
- Top-K = 3 (small enough to fit in prompt, large enough to show variety).
- Examples are filtered to **same platform** (X vs Reddit) to avoid cross-platform style bleed.
- Examples are filtered to **not include the same parent post** (no leakage of identical-context replies).
- Examples are **deduplicated** by content hash (don't show the same reply twice).
- Max 1 example per `author_handle` (avoid showing 3 replies all to the same KOL).
- Examples are sorted by recency (most recent first within BM25 top-K).
- `tone_used` (existing `EReplyTone` enum) is used as a secondary filter — if the AI is generating a "challenging" reply, prefer past "challenging" replies.

---

## Files to Create

### `src/services/replyMemoryService.ts` (~140 lines)

The public API for memory retrieval. `memoryTools.ts` is a low-level helper; `replyMemoryService` is the business logic.

```typescript
import { log } from "../utils/logger.js";
import { createHash } from "node:crypto";
import { Reply, EReplyStatus, EReplyPlatform } from "../db/models/Reply.js";

const TOP_K = 3;
const MIN_BM25_SCORE = 0.5;  // MongoDB $text meta-score threshold (tune empirically)

export interface IFewShotExample {
  reply_text: string;
  tone: string;
  parent_context: string;     // The post/comment we replied to (first 200 chars)
  created_at: Date;
}

export interface IFewShotQuery {
  contextText: string;        // The current KOL post or comment we're replying to
  platform: EReplyPlatform;
  tone?: string;              // Optional tone filter
  authorHandle?: string;      // Optional: exclude replies to this author (e.g. don't show past reply to the same KOL)
  topK?: number;
}

export async function findFewShotExamples(q: IFewShotQuery): Promise<IFewShotExample[]> {
  try {
    const k = q.topK ?? TOP_K;
    
    // Step 1: BM25 query via MongoDB $text. Filter to posted, same platform.
    const filter: Record<string, unknown> = {
      status: EReplyStatus.REPLIED,
      platform: q.platform,
      reply_content: { $exists: true, $ne: "" },
      ...(q.authorHandle ? { author_handle: { $ne: q.authorHandle } } : {}),
    };
    
    const textQuery: Record<string, unknown> = { $text: { $search: extractKeywords(q.contextText) } };
    const candidates = await Reply.find({ ...filter, ...textQuery })
      .select("reply_content tone_used author_handle parent_post_url created_at")
      .sort({ score: { $meta: "textScore" }, created_at: -1 })
      .limit(k * 4)  // over-fetch for dedup + diversity
      .lean();
    
    if (candidates.length === 0) {
      // Fallback: no BM25 hits — return most recent posted replies (still useful as style examples)
      const recent = await Reply.find(filter)
        .select("reply_content tone_used author_handle parent_post_url created_at")
        .sort({ created_at: -1 })
        .limit(k)
        .lean();
      return recent.map(toExample);
    }
    
    // Step 2: Deduplicate by content hash, dedupe per author_handle, prefer tone match.
    const seenHash = new Set<string>();
    const seenAuthor = new Set<string>();
    const out: IFewShotExample[] = [];
    
    // Prefer tone-matched candidates first
    const sorted = q.tone
      ? [
          ...candidates.filter((c) => c.tone_used === q.tone),
          ...candidates.filter((c) => c.tone_used !== q.tone),
        ]
      : candidates;
    
    for (const c of sorted) {
      if (out.length >= k) break;
      const hash = createHash("sha256").update(c.reply_content).digest("hex").slice(0, 16);
      if (seenHash.has(hash)) continue;
      if (seenAuthor.has(c.author_handle ?? "")) continue;
      seenHash.add(hash);
      seenAuthor.add(c.author_handle ?? "");
      out.push(toExample(c));
    }
    
    return out;
  } catch (err: unknown) {
    log.error(`[ReplyMemory] findFewShotExamples failed: ${(err as Error).message}`);
    return [];
  }
}

function toExample(c: { reply_content: string; tone_used: string; parent_post_url?: string; created_at: Date }): IFewShotExample {
  return {
    reply_text: c.reply_content,
    tone: c.tone_used,
    parent_context: c.parent_post_url ?? "(no parent context stored)",
    created_at: c.created_at,
  };
}

function extractKeywords(text: string): string {
  // BM25 best-practice: 5-10 distinctive keywords. Drop stop words, keep tokens ≥3 chars.
  const STOP = new Set(["the", "and", "for", "with", "this", "that", "from", "have", "are", "was", "you", "your", "but", "not", "his", "her", "they", "their", "what", "all", "can", "had", "she", "him", "one", "our", "out", "day", "get", "use", "now", "how", "man", "new", "old", "see", "way", "may"]);
  const words = text.toLowerCase().match(/[a-z0-9$]{3,}/g) ?? [];
  const unique = [...new Set(words)].filter((w) => !STOP.has(w));
  return unique.slice(0, 10).map((w) => `"${w}"`).join(" ");
}
```

### `src/prompts/kolPrompts.ts` (modify, not create)

Add a new function that wraps the existing `buildReplyGenerationPrompt` and prepends a `PAST REPLIES (your style, few-shot)` section.

```typescript
// Add to kolPrompts.ts (after buildReplyGenerationPrompt, before buildSelfReplyPrompt)

export function buildReplyGenerationPromptWithFewShot(params: {
  // Same as buildReplyGenerationPrompt + few_shot
  handle: string;
  postSummary: string;
  trendingTopics: string[];
  topComments: Array<{ content: string; author_handle: string; sentiment: string }>;
  postContent: string;
  dominantTone: string;
  commonPhrases: string[];
  emojiTrend: string[];
  authorVoiceStyle?: string;
  authorSlangReference?: string;
  authorStyleFormulas?: string;
  fewShot?: Array<{ reply_text: string; tone: string }>;
}): string {
  const baseParams = { ...params };
  const base = buildReplyGenerationPrompt(baseParams);
  if (!params.fewShot || params.fewShot.length === 0) return base;
  
  const fewShotBlock = "\nPAST REPLIES (your style — match this register and cadence):\n" +
    params.fewShot
      .map((ex, i) => `  ${i + 1}. [${ex.tone}] "${ex.reply_text}"`)
      .join("\n") +
    "\n";
  
  // Insert before KOL CONTEXT block
  return base.replace(
    "KOL CONTEXT",
    `${fewShotBlock}\nKOL CONTEXT`,
  );
}

export function buildSelfReplyPromptWithFewShot(params: {
  // Same as buildSelfReplyPrompt + few_shot
  originalPostContent: string;
  commentAuthor: string;
  commentContent: string;
  commentLikes: number;
  authorTrustScore: number;
  interactionCount: number;
  yourStyle: string;
  fewShot?: Array<{ reply_text: string; tone: string }>;
}): string {
  const base = buildSelfReplyPrompt(params);
  if (!params.fewShot || params.fewShot.length === 0) return base;
  
  const fewShotBlock = "\nPAST REPLIES (your style — match this register and cadence):\n" +
    params.fewShot
      .map((ex, i) => `  ${i + 1}. [${ex.tone}] "${ex.reply_text}"`)
      .join("\n") +
    "\n";
  
  return base.replace(
    "REPLY GUIDELINES:",
    `${fewShotBlock}\nREPLY GUIDELINES:`,
  );
}
```

---

## Files to Modify

### `src/tools/memoryTools.ts` (currently 1 line, empty)

Fill it in as a thin wrapper around the service. Keep the file name "tools" for the import-side consistency.

```typescript
/** memoryTools — thin facade for reply memory retrieval.
 * Most logic lives in `replyMemoryService.ts`; this file is a stable
 * import surface so callers don't depend on the service directly.
 */
export { findFewShotExamples, computeEditRatio } from "../services/replyMemoryService.js";
export type { IFewShotExample, IFewShotQuery } from "../services/replyMemoryService.js";
```

(Optionally re-export `computeEditRatio` from Phase 3's `replyEvalService` if not duplicated — but we already exported it from `replyEvalService` in Phase 3, so skip.)

### `src/services/replyEngineService.ts` (line 192-208, in `generateSuggestions`)

Add few-shot retrieval before the `buildReplyGenerationPrompt` call. Async, with try/catch — failure falls back to no examples (no error to caller).

```typescript
import { findFewShotExamples } from "./replyMemoryService.js";
// ...

// Inside generateSuggestions, after the analysis gate, before buildReplyGenerationPrompt:
let fewShot: Awaited<ReturnType<typeof findFewShotExamples>> = [];
try {
  fewShot = await findFewShotExamples({
    contextText: post.content + " " + (post.analysis?.summary ?? ""),
    platform: EReplyPlatform.X,  // KOL is X-only for now
    authorHandle: kol.handle,    // Don't show past replies to the same KOL
    tone: post.engagement_pattern?.dominant_tone,
  });
} catch (e: unknown) {
  log.warn(`[ReplyEngine] Few-shot retrieval failed: ${(e as Error).message}`);
}

const prompt = buildReplyGenerationPromptWithFewShot({
  // ... same params ...
  fewShot,
});
```

(Phase 4 only — the change in Phase 2 was the `LEARNED VOICE` block, not few-shot.)

### `src/services/selfReplyService.ts` (line 408-457, in `queueSelfReplyGeneration`)

Same pattern, applied to self-reply.

```typescript
import { findFewShotExamples } from "./replyMemoryService.js";
// ...

// In queueSelfReplyGeneration, after the OwnAccountProfile fetch:
let fewShot: Awaited<ReturnType<typeof findFewShotExamples>> = [];
try {
  fewShot = await findFewShotExamples({
    contextText: (post?.raw_content ?? "") + " " + comment.content,
    platform: EReplyPlatform.X,
    authorHandle: comment.author_handle,  // Don't show past replies to the same commenter
  });
} catch (e: unknown) {
  log.warn(`[SelfReply] Few-shot retrieval failed: ${(e as Error).message}`);
}

const prompt = buildSelfReplyPromptWithFewShot({
  // ... same params ...
  fewShot,
});
```

### `src/db/models/Reply.ts` (line 68-72, indexes)

Add a text index for BM25:

```typescript
replySchema.index({ reply_content: "text" });
```

(If this conflicts with an existing index — verify there isn't one. The Reply model has 5 existing indexes: status+created_at, platform, url, author_handle, parent_post_url. None on `reply_content`. Safe to add.)

### `src/db/index.ts` (barrel)

No new model exports — `Reply` is already exported.

---

## Files to Delete

None. (Same caveat as Phase 3 — `PersonaKnowledge` is dead code, but deletion is a separate concern.)

---

## Implementation Steps

### Phase 4a (recommended, ships first)

1. Add `reply_content` text index to `src/db/models/Reply.ts`.
2. Create `src/services/replyMemoryService.ts` with `findFewShotExamples()`.
3. Fill in `src/tools/memoryTools.ts` as a thin re-export.
4. Add `buildReplyGenerationPromptWithFewShot` and `buildSelfReplyPromptWithFewShot` to `src/prompts/kolPrompts.ts`.
5. Wire `findFewShotExamples` into `replyEngineService.generateSuggestions`.
6. Wire `findFewShotExamples` into `selfReplyService.queueSelfReplyGeneration`.
7. Run `npm run typecheck`.
8. Manual: trigger a KOL reply, inspect the prompt — confirm `PAST REPLIES` block present, contains 3 distinct examples.

### Phase 4b (optional, only if 4a doesn't help)

1. Pick embedding model (recommendation: `text-embedding-3-small` via OpenRouter, ~$0.02/1M tokens, or local `all-MiniLM-L6-v2` via `@xenova/transformers`).
2. Add vector field to `Reply` model: `embedding: [Number]` (e.g. 384 or 1536 floats).
3. Add embedding step to the `Reply.status: REPLIED` transition (webhook in `tasks.ts:188-192`).
4. Add vector store: **MUST discuss with user** before adding infra. Options:
   - **MongoDB Atlas `$vectorSearch`** — requires Atlas (not self-hosted Mongo). Check current MongoDB deployment in `MONGO_URI`.
   - **In-process HNSW (e.g. `hnswlib-node`)** — fast, but lost on restart. Need to re-load on boot.
   - **Redis vector sets** (Redis 8+) — check Redis version.
5. If going with a vector store, add `findSimilarRepliesByVector()` to `replyMemoryService.ts`, parallel to `findFewShotExamples`.
6. Update KOL + self-reply callers to prefer vector search, fall back to BM25.

**Strongly recommend stopping at 4a unless the eval log shows BM25 isn't enough.**

---

## Todo List

### Phase 4a (required)
- [ ] Add `reply_content` text index to `Reply` model
- [ ] Create `replyMemoryService.ts` with `findFewShotExamples` + `extractKeywords` helpers
- [ ] Fill in `memoryTools.ts` as re-export
- [ ] Add `buildReplyGenerationPromptWithFewShot` to `kolPrompts.ts`
- [ ] Add `buildSelfReplyPromptWithFewShot` to `kolPrompts.ts`
- [ ] Wire `findFewShotExamples` into `replyEngineService.generateSuggestions`
- [ ] Wire `findFewShotExamples` into `selfReplyService.queueSelfReplyGeneration`
- [ ] `npm run typecheck` passes
- [ ] Manual: trigger KOL reply, inspect prompt for `PAST REPLIES` block

### Phase 4b (optional, gated on Phase 3 metrics)
- [ ] Decide embedding model with user
- [ ] Decide vector store with user (Atlas vs in-process vs Redis)
- [ ] Add `embedding` field to `Reply` model
- [ ] Add embedding step to webhook (`tasks.ts:188`)
- [ ] Add `findSimilarRepliesByVector()` to `replyMemoryService.ts`
- [ ] Update KOL + self-reply callers

---

## Success Criteria

### Phase 4a
- `Reply.reply_content` has a text index (verify via `db.replies.getIndexes()`).
- `findFewShotExamples` returns ≤3 distinct, non-duplicate examples.
- The injected `PAST REPLIES` block sits before the `KOL CONTEXT` / `REPLY GUIDELINES` block.
- No examples from the same KOL as the current post.
- No more than 1 example per `author_handle` in the result set.
- If BM25 returns 0 results, falls back to most-recent posted replies (still useful).
- Eval log (Phase 3) shows a measurable improvement in `avg_edit_ratio` after Phase 4a lands. **If not — stop, do not proceed to 4b.**

### Phase 4b (if reached)
- Vector store indexed and queryable.
- Embedding generation adds <500ms to webhook latency (p95).
- Eval log shows further `avg_edit_ratio` improvement over Phase 4a.

---

## Test Strategy

**Unit** (`src/tests/replyMemoryService.test.ts`):
- `extractKeywords("just shipped a new AI tool")` → at least 3 keywords, no stop words.
- `findFewShotExamples` with empty `Reply` collection → returns `[]` (graceful).
- `findFewShotExamples` with 10 POSTED replies, query "shipping product" → returns 3 distinct, most recent first.
- `findFewShotExamples` with 5 replies to the same author → excludes all 5 when `authorHandle` matches.
- `findFewShotExamples` with tone filter → prefers tone-matched candidates (verify order).

**Integration** (manual):
- Seed 5+ POSTED `Reply` records (or use existing dev data).
- Trigger a KOL reply via Telegram — inspect prompt for `PAST REPLIES` block.
- Confirm examples are stylistically relevant (sanity check, not measurable).

**Eval log comparison** (manual, run after Phase 3 + Phase 4a both ship):
- `db.replyevallogs.aggregate([{$match: {created_at: {$gte: <phase4a-deploy-date>}}}, {$group: {_id: null, avg: {$avg: "$edit_ratio"}}}])` — should be < pre-Phase-4a baseline.

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| BM25 returns irrelevant examples (lexical ≠ semantic similarity) | Medium | Phase 3 eval log measures this. If `edit_ratio` doesn't drop, stop at 4a — don't proceed to 4b embedding work. |
| Few-shot examples bias the model toward past content (LLM copies phrases) | Medium | Cap at 3 examples, dedupe aggressively, use only POSTED+REPLIED (admin-approved) examples. |
| Text index on `reply_content` slows down writes | Low | MongoDB text indexes have minimal write overhead for typical reply sizes (~280 chars). Re-benchmark in dev. |
| `findFewShotExamples` adds latency to webhook | Low | Single MongoDB query, ~5-20ms. Acceptable. If it becomes a bottleneck, add a 60s Redis cache on `(contextText hash, platform)`. |
| Phase 4b (vector search) requires infra the user doesn't have | High | **Why we recommend stopping at 4a.** Don't propose vector infrastructure in the same PR. |
| Empty `Reply` collection on a fresh deployment | Low | `findFewShotExamples` returns `[]`, callers fall back to no few-shot. No regression. |
| `tone_used` field on `Reply` is not populated for older records | Medium | Filter `tone_used: { $exists: true, $ne: "" }` in the query. Pre-populated data with empty tone is silently skipped (treated as unfiltered). |

---

## Security Considerations

- Few-shot examples come from admin-approved `REPLIED` records only — no PII risk beyond what's already in the DB.
- The injected examples are visible to the LLM, not to end users. Standard LLM prompt injection risk: a malicious admin reply could contain "ignore previous instructions" and steer the LLM. Mitigation: post-reply validation (already in `replyEngineService` via the post-generation analysis step). Or strip non-ASCII / control chars from `reply_content` before indexing. **Recommendation: leave for a Phase 4.1 follow-up.**
- `extractKeywords` outputs to a MongoDB `$text` query — no shell injection (Mongoose parameterizes).

---

## Unresolved Questions

1. **Confirm the BM25 alternative (Phase 4a) is acceptable in place of vector search.** This is the main decision for this phase. The user explicitly asked for the simpler alternative to be flagged — this plan proposes it as the primary path. **Awaiting user confirmation.**
2. **What's the MongoDB deployment?** `MONGO_URI` defaults to `mongodb://localhost:27017/cinee_pipeline` (self-hosted). Self-hosted Mongo does support `$text` (good for 4a) but does **not** support `$vectorSearch` (bad for 4b). If the prod is Atlas, 4b becomes viable. **Need to check `MONGO_URI` in production.**
3. **What's the Redis version?** Vector sets (Redis 8+) would be a lightweight option for 4b. `src/db/redis.ts` doesn't pin a version. **Need to check `REDIS_URL` connection + Redis version.**
4. **How many past `Reply` records are there?** If <50, BM25 will be thin. **Recommendation: run a count query in dev before deciding top-K.** If <50 POSTED replies, lower `TOP_K` to 2.
5. **Should `findFewShotExamples` also include past CEO-authored posts (`Post.raw_content` with `status: POSTED`)?** The CEO's posts show writing style; their replies show **reply** style. These are different distributions. **Recommendation: keep them separate in Phase 4a. Add a `findFewShotPostExamples()` in Phase 4.1 if needed.**

---

## Next Steps

After Phase 4a lands, monitor the eval log (Phase 3) for 2-4 weeks:
- If `avg_edit_ratio` drops by ≥10%, Phase 4a worked. Document the win. Consider Phase 4b as a future optimization.
- If `avg_edit_ratio` is flat or rises, the few-shot injection is adding noise. Revert the few-shot callers (keep the service + index — they're cheap and might be useful later).
- If the KOL reply rate drops because the AI is more cautious (mirroring past safe replies), that's a separate signal to monitor via the `sent_at` field on `KolReplySuggestion`.
