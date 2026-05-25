---
status: completed
phase: 01
blocks: phase-02
completed: 2026-05-25
---

# Phase 01 — Crawl-time Content Filter

## Context Links

- Spec: [spec.md](./spec.md#optimization-1-crawl-time-content-filter)
- Target file: `src/services/kolCrawlerService.ts`

## Overview

- Priority: High (highest ROI, lowest risk)
- Savings: ~$0.7/day
- Drop low-value posts before `KolPost.create()` — they never enter analysis or reply gen pipeline

## Key Insights

- 53% of crawled posts are retweets — currently saved to DB and go through full pipeline
- Short posts ("wow", "76.7") waste analysis + reply gen budget
- Content length is safer primary signal than velocity at crawl time (velocity penalizes old high-engagement posts)
- `processCrawlResults()` is the single insertion point — all paths (batch + single) call it
- `processBatchCrawlResult()` already has a stale-post guard pattern to follow

## Requirements

- Drop `is_retweet` posts before DB insert
- Drop posts with `content.trim().length < 15`
- Drop quote posts with `content.trim().length < 30`
- Log dropped count per handle for monitoring
- Return dropped count in `processCrawlResults()` result

## Architecture

```
parseBatchCrawlResult()
  → processBatchCrawlResult()
    → processCrawlResults()          ← INSERT shouldDropAtCrawl() check here
        → KolPost.create()           ← only reached if passes filter
```

`shouldDropAtCrawl()` is a pure function — no DB calls, no side effects.

## Related Code Files

- `/home/sotatek/Documents/cinee-openclaw/cinee-pipline/src/services/kolCrawlerService.ts`
  - `processCrawlResults()` — lines 260–315 — add filter before `KolPost.create()`
  - `ICrawlResult` interface — line 59–65 — add `dropped` field
  - Return value `{ saved, skipped, posts }` — add `dropped` count

## Implementation Steps

1. Add `shouldDropAtCrawl()` pure function after the `calculateEngagementScore()` function (around line 317):

```typescript
function shouldDropAtCrawl(raw: IRawPost): boolean {
  if (raw.is_retweet) return true;
  if (raw.content.trim().length < 15) return true;
  if (raw.is_quote && raw.content.trim().length < 30) return true;
  return false;
}
```

2. Update `ICrawlResult` interface to include `dropped` field:

```typescript
export interface ICrawlResult {
  kolId: string | Types.ObjectId;
  handle: string;
  postsFound: number;
  postsSaved: number;
  dropped: number;        // ← add this
  errors: string[];
}
```

3. In `processCrawlResults()`, update return type and add `dropped` counter:

```typescript
export async function processCrawlResults(
  kolId: string | Types.ObjectId,
  rawPosts: IRawPost[],
): Promise<{ saved: number; skipped: number; dropped: number; posts: IKolPost[] }> {
  let saved = 0;
  let skipped = 0;
  let dropped = 0;
  const posts: IKolPost[] = [];

  for (const raw of rawPosts) {
    try {
      // Drop low-value posts before any DB operation
      if (shouldDropAtCrawl(raw)) {
        dropped++;
        continue;
      }

      const existing = await KolPost.findOne({ post_url: raw.post_url });
      // ... rest unchanged
```

4. Update `return` statement in `processCrawlResults()`:

```typescript
  return { saved, skipped, dropped, posts };
```

5. Update `processBatchCrawlResult()` to propagate `dropped` in log and result:

In the loop where `processCrawlResults` is called (line ~377):
```typescript
const { saved, skipped, dropped, posts: savedPosts } = await processCrawlResults(kol._id, topPosts);
// ...
log.info(`[KolCrawler] @${handle}: ${posts.length} found, ${saved} saved, ${skipped} skipped, ${dropped} dropped at crawl`);
```

Update the `results.push()` call to include `dropped`:
```typescript
results.push({
  kolId: kol._id,
  handle: kol.handle,
  postsFound: posts.length,
  postsSaved: saved,
  dropped,
  errors: [],
});
```

6. Fix all other `ICrawlResult` construction sites that don't have `dropped` — add `dropped: 0` to error fallback objects in `processBatchCrawlResult()` and `crawlAllKols()` / `crawlKol()`.

7. Run `npm run typecheck` to catch any missed `ICrawlResult` construction sites.

## Todo List

- [x] Add `shouldDropAtCrawl()` function
- [x] Add `dropped` field to `ICrawlResult` interface
- [x] Update `processCrawlResults()` signature + counter + early-continue
- [x] Update `processBatchCrawlResult()` to destructure + log `dropped`
- [x] Fix all `ICrawlResult` construction sites (add `dropped: 0`)
- [x] Run `npm run typecheck` — fix all errors
- [x] Manual smoke test: verify retweet posts no longer appear in DB after crawl

## Success Criteria

- `shouldDropAtCrawl()` returns `true` for: retweets, content < 15 chars, quote + content < 30 chars
- `dropped` count appears in crawl logs per handle
- No TypeScript errors
- Existing `saved`/`skipped` logic unchanged

## Risk Assessment

- **Over-filtering:** 15-char threshold may drop valid short posts. Monitor `dropped` log count. If too aggressive, raise threshold to 20 or add exception for high-engagement posts.
- **Interface breakage:** `ICrawlResult` is used in routes/controllers — adding `dropped` is additive, non-breaking.
- **No DB migration needed** — filter is purely at insert time.

## Next Steps

After this phase: implement Phase 2 (pre-reply-gen gate) — uses `is_spam` + `quality_score` from analysis.
