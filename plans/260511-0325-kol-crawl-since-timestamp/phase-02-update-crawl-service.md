# Phase 2: Update Crawl Service — Cap Logic + Prompt Format

## Overview

- **File:** `src/services/kolCrawlerService.ts`
- **Priority:** High
- **Effort:** ~30 min
- **Blocked by:** Phase 1

## Changes

Three targeted edits in this file:

---

### 2a — Add 24h cap constant (top of file, near existing cache constants)

```ts
const MAX_CRAWL_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h max crawl window
```

---

### 2b — Update `crawlAllKolsSequential`: replace `getDefaultSinceDate()` with capped logic

**Location:** `crawlAllKolsSequential()` → the `for (const kol of kols)` loop, when building `kolInfos`.

**Before (line ~531-536):**
```ts
const cachedLastCrawled = await getCachedLastCrawled(kol.handle);
const since = cachedLastCrawled ?? kol.last_crawled_at ?? getDefaultSinceDate();
kolInfos.push({
  handle: kol.handle,
  since: since.toISOString(),
  limit: kolSettings.max_posts_per_crawl,
});
```

**After:**
```ts
const cachedLastCrawled = await getCachedLastCrawled(kol.handle);
const oldestAllowed = new Date(Date.now() - MAX_CRAWL_WINDOW_MS);
const rawSince = cachedLastCrawled ?? kol.last_crawled_at ?? null;
const since = rawSince && rawSince > oldestAllowed ? rawSince : oldestAllowed;
kolInfos.push({
  handle: kol.handle,
  since: since.toISOString(),
  limit: kolSettings.max_posts_per_crawl,
});
```

`getDefaultSinceDate()` is no longer called from this path. It remains used by `crawlKol()` (single-KOL path, out of scope).

---

### 2c — Update `BATCH_KOL_CRAWL_PROMPT_TEMPLATE`: per-handle since in instructions

**Before:**
```
For each handle below, sequentially:
1. Navigate to https://x.com/{handle}, wait 8s, scroll 3x (2s each)
2. Run TWEET_SCRIPT via page.evaluate(), collect posts
3. For each post where comments > 10 (max 5 posts per KOL):
   a. Navigate to post_url, wait 4s
   b. Run COMMENT_SCRIPT via page.evaluate(), add as top_comments
   c. Navigate back to profile
4. Wait 10s before next handle

Handles: {{handleList}}

TWEET_SCRIPT:
\`\`\`
${KOL_TWEET_SCRIPT}
\`\`\`
...
```

**After:**
```
For each handle below, sequentially:
1. Navigate to https://x.com/{handle}, wait 8s, scroll 3x (2s each)
2. Run TWEET_SCRIPT via page.evaluate(TWEET_SCRIPT, sinceTimestamp), passing the sinceTimestamp shown for that handle
3. For each post where comments > 10 (max 5 posts per KOL):
   a. Navigate to post_url, wait 4s
   b. Run COMMENT_SCRIPT via page.evaluate(), add as top_comments
   c. Navigate back to profile
4. Wait 10s before next handle

Handles:
{{handleList}}

TWEET_SCRIPT (call as: page.evaluate(TWEET_SCRIPT, sinceTimestamp)):
\`\`\`
${KOL_TWEET_SCRIPT}
\`\`\`
...
```

---

### 2d — Update `createBatchCrawlTask`: format `handleList` with sinceTimestamp per line

**Before:**
```ts
const handleList = kols.map(k => `@${k.handle}`).join(", ");
```

**After:**
```ts
const handleList = kols
  .map(k => `- @${k.handle} | sinceTimestamp: "${k.since}"`)
  .join("\n");
```

---

## Todo

- [ ] Add `MAX_CRAWL_WINDOW_MS` constant near `KOL_CRAWL_CACHE_TTL`
- [ ] Update `crawlAllKolsSequential` loop: replace `getDefaultSinceDate()` fallback with 24h cap logic
- [ ] Update `BATCH_KOL_CRAWL_PROMPT_TEMPLATE` step 2 instruction to mention `page.evaluate(TWEET_SCRIPT, sinceTimestamp)`
- [ ] Update `BATCH_KOL_CRAWL_PROMPT_TEMPLATE` TWEET_SCRIPT label to note calling convention
- [ ] Update `handleList` format in `createBatchCrawlTask` to `- @handle | sinceTimestamp: "..."`
- [ ] Confirm `getDefaultSinceDate()` still exists and is only used by `crawlKol()` (no deletion needed)

## Success Criteria

- `crawlAllKolsSequential` computes `effectiveSince = max(rawSince, now - 24h)` for every KOL
- Batch prompt `handleList` contains one line per KOL with ISO `sinceTimestamp`
- Prompt instruction tells agent to call `page.evaluate(TWEET_SCRIPT, sinceTimestamp)`
- KOL never crawled → `effectiveSince = now - 24h` (not null, not undefined)
- KOL with stale cache (>24h old) → `effectiveSince = now - 24h`
- KOL with fresh cache → `effectiveSince = cachedLastCrawled`
