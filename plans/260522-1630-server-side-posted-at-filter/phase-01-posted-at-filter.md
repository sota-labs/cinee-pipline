# Phase 01 — Server-side posted_at Filter

## Overview

- **Priority:** High
- **Status:** Completed
- **Description:** 4 targeted edits across 2 files. No new files, no schema changes.

## Related Code Files

- **Modify:** `src/services/kolCrawlerService.ts`
- **Modify:** `src/routes/tasks.ts`

## Key Insights

- `createBatchCrawlTask` already has a `payload` object (line ~156) with `action`, `kolCount`, `handles`. Adding `sinceByHandle` is purely additive.
- `processBatchCrawlResult` signature is `(taskResult: string, handles: string[])`. Adding `sinceByHandle?: Record<string, string>` as third optional param is backward-compatible — existing callers (tests, manual routes) pass nothing and get no filter.
- The webhook at `tasks.ts` line ~231 already reads `payload.handles` — it just needs to also read `payload.sinceByHandle` and pass it through.
- `posted_at` in `IRawPost` is a string (ISO). `new Date(p.posted_at)` is safe; if parse fails it returns `Invalid Date` whose `getTime()` is `NaN`, and `NaN > sinceDate` is `false` — post gets dropped (conservative, correct).
- `BATCH_KOL_CRAWL_PROMPT_TEMPLATE` is a template literal at line ~96. Add one IMPORTANT line after the existing scroll-stop instruction.

## Implementation Steps

### Step 1 — Strengthen prompt in `BATCH_KOL_CRAWL_PROMPT_TEMPLATE`

After the line:
```
   - Only process posts returned by the script (already filtered to newer than sinceTimestamp)
```

Add:
```
   - IMPORTANT: Do NOT include any post where posted_at <= sinceTimestamp in your JSON output
```

### Step 2 — Add `sinceByHandle` to `createBatchCrawlTask` payload

In `createBatchCrawlTask`, update the `Task.create` payload block from:
```typescript
payload: {
  action: "batch_crawl",
  kolCount: kols.length,
  handles: kols.map(k => k.handle),
},
```
To:
```typescript
payload: {
  action: "batch_crawl",
  kolCount: kols.length,
  handles: kols.map(k => k.handle),
  sinceByHandle: Object.fromEntries(kols.map(k => [k.handle, k.since])),
},
```

### Step 3 — Add `sinceByHandle` param + filter to `processBatchCrawlResult`

Change signature:
```typescript
export async function processBatchCrawlResult(
  taskResult: string,
  handles: string[],
  sinceByHandle?: Record<string, string>,
): Promise<ICrawlResult[]>
```

In the per-handle loop, after `const { handle, posts } of batchResults`, before the `MAX_POSTS_PER_HANDLE` slice, add:

```typescript
// Server-side guard: drop posts older than the since timestamp used to prompt the agent
const sinceISO = sinceByHandle?.[handle];
const sinceDate = sinceISO ? new Date(sinceISO) : null;
const freshPosts = sinceDate
  ? posts.filter(p => {
      const postedAt = new Date(p.posted_at);
      return !isNaN(postedAt.getTime()) && postedAt > sinceDate;
    })
  : posts;
if (sinceDate && freshPosts.length < posts.length) {
  log.info(`[KolCrawler] @${handle}: dropped ${posts.length - freshPosts.length} stale posts (posted_at <= ${sinceISO})`);
}
```

Then replace `posts` with `freshPosts` in the `MAX_POSTS_PER_HANDLE` block:
```typescript
const topPosts = freshPosts.length > MAX_POSTS_PER_HANDLE
  ? [...freshPosts]
      .sort((a, b) => calculateEngagementScore(b) - calculateEngagementScore(a))
      .slice(0, MAX_POSTS_PER_HANDLE)
  : freshPosts;

if (freshPosts.length > MAX_POSTS_PER_HANDLE) {
  log.info(`[KolCrawler] @${handle}: ${freshPosts.length} fresh posts, keeping top ${MAX_POSTS_PER_HANDLE} by engagement`);
}
```

### Step 4 — Pass `sinceByHandle` through in `tasks.ts` webhook

In the `batch_crawl` handler block (~line 231), change:
```typescript
const handles = payload.handles as string[];
setImmediate(async () => {
  try {
    log.info(`[Webhook] Auto-processing batch_crawl result for task ${task._id}`);
    const results = await processBatchCrawlResult(task.result!, handles);
```
To:
```typescript
const handles = payload.handles as string[];
const sinceByHandle = payload.sinceByHandle as Record<string, string> | undefined;
setImmediate(async () => {
  try {
    log.info(`[Webhook] Auto-processing batch_crawl result for task ${task._id}`);
    const results = await processBatchCrawlResult(task.result!, handles, sinceByHandle);
```

## Todo

- [x] Add IMPORTANT line to `BATCH_KOL_CRAWL_PROMPT_TEMPLATE`
- [x] Add `sinceByHandle` to `createBatchCrawlTask` payload
- [x] Add `sinceByHandle` optional param + filter logic to `processBatchCrawlResult`
- [x] Pass `sinceByHandle` from webhook payload to `processBatchCrawlResult`
- [x] Run `tsc --noEmit` — zero errors

## Success Criteria

- `tsc --noEmit` passes
- A post with `posted_at` older than `since` is dropped and logged: `dropped N stale posts`
- A post with `posted_at` newer than `since` is saved normally
- Tasks created before this change (no `sinceByHandle` in payload) still process without error

## Risk Assessment

- **Low risk.** Purely additive — optional param, no schema change, no breaking change to existing callers.
- The only behavioral change: stale posts that previously slipped through are now dropped. This is the intended fix.
- `last_crawled_at` is still updated even if all posts are filtered (correct — the crawl happened, just no new posts).
