---
phase: 3
priority: medium
effort: small
---

# Phase 3: Reply Engine Filter

## File

- `src/services/replyEngineService.ts`

---

## Context

Reply engine queries posts with `status: ANALYZED`. Posts reach `ANALYZED` after `kolAnalyzerService` processes them. The analyzer is triggered after crawl — but now comments arrive later (Phase 2 task).

We need to ensure reply engine only picks up posts where comments have been crawled.

---

## Change: Add comments_crawled filter to KolPost query

**Location**: The `findOneAndUpdate` query that transitions `ANALYZED → PENDING_REPLY`.

```typescript
// Before
const post = await KolPost.findOneAndUpdate(
  { _id: postId, status: EKolPostStatus.ANALYZED },
  { $set: { status: EKolPostStatus.PENDING_REPLY } },
  { new: true },
).populate("kol_id");

// After
const post = await KolPost.findOneAndUpdate(
  { _id: postId, status: EKolPostStatus.ANALYZED, comments_crawled: true },
  { $set: { status: EKolPostStatus.PENDING_REPLY } },
  { new: true },
).populate("kol_id");
```

**Effect**: Posts that haven't had comments crawled yet will not be picked up by reply engine. Once Phase 2 task completes and sets `comments_crawled: true`, the post becomes eligible on the next reply engine tick.

---

## Edge case: posts with comments <= 10

Posts with `comments <= 10` are skipped by Phase 2 (no comment crawl task created for them). These posts will have `comments_crawled: false` forever → reply engine never picks them up.

**Fix**: In `processCrawlResults()` (Phase 2 of plan), set `comments_crawled: true` immediately for posts with `comments <= 10` since they don't need comment crawling:

```typescript
// In processCrawlResults(), when saving each post:
const comments_crawled = rawPost.comments <= 10; // no crawl needed for low-comment posts
await KolPost.create({ ...postData, comments_crawled });
```

This is handled in Phase 2 (crawler refactor) — noted here for awareness.

---

## Todo

- [ ] Add `comments_crawled: true` to the `findOneAndUpdate` filter in `replyEngineService.ts`
- [ ] Verify the query uses the new compound index `{ status, comments_crawled, crawled_at }`
- [ ] Run `npx tsc --noEmit` to verify no type errors
