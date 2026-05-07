---
title: "Phase 3: Modify KolCrawlerService"
status: pending
effort: 2h
---

# Phase 3: Modify KolCrawlerService

## Context Links

- [Spec](./spec.md) -- Sections "2. New Prompt Templates" and "4. processBatchCrawlResult"
- [kolCrawlerService.ts](../src/services/kolCrawlerService.ts) -- file to modify
- [Phase 1](./phase-01-create-extraction-scripts.md) -- provides KOL_TWEET_SCRIPT, KOL_COMMENT_SCRIPT
- [Phase 2](./phase-02-create-result-parser.md) -- provides parseBatchCrawlResult, IRawPost

## Overview

- **Priority:** Critical -- core change that delivers the optimization
- **Status:** Pending
- **Description:** Replace the verbose prompt templates in `kolCrawlerService.ts` with minimal JS-injection prompts, remove the local `IRawPost` interface (import from parser), and add `processBatchCrawlResult()` as a new exported function.

## Key Insights

- The existing `crawlAllKolsSequential()` function (line 537-626) already has inline JSON parsing of batch results. This will be replaced with a call to `parseBatchCrawlResult()`.
- The single KOL `KOL_CRAWL_PROMPT_TEMPLATE` is used by `createCrawlTask()` (line 228-251). It needs the same JS-injection treatment.
- The batch template `BATCH_KOL_CRAWL_PROMPT_TEMPLATE` is used by `createBatchCrawlTask()` (line 193-222).
- `IComment` interface (lines 61-66) stays in the service -- it's used by other parts of the system.
- `processCrawlResults()` (line 276-326) is **unchanged** -- `processBatchCrawlResult` calls it per handle.

## Requirements

### Functional
1. Replace `KOL_CRAWL_PROMPT_TEMPLATE` (~40 lines) with ~15-line JS-injection version
2. Replace `BATCH_KOL_CRAWL_PROMPT_TEMPLATE` (~70 lines) with ~18-line JS-injection version
3. Remove local `IRawPost` interface; import from `kolCrawlResultParser.ts`
4. Add `processBatchCrawlResult(taskResult, handles)` exported function
5. Refactor `crawlAllKolsSequential()` to use `parseBatchCrawlResult()` instead of inline JSON.parse

### Non-functional
- File should remain under 200 lines after changes (currently 631 -- too large)
- Prompt templates should be < 20 lines each
- No breaking changes to existing public API (`processCrawlResults`, `KolCrawlerService` class, `crawlAllKolsSequential`)

## Architecture

```
kolCrawlerService.ts (after changes)
  IMPORTS:
    + KOL_TWEET_SCRIPT, KOL_COMMENT_SCRIPT (from kolCrawlScript.ts)
    + parseBatchCrawlResult, parseSingleCrawlResult, IRawPost (from kolCrawlResultParser.ts)
    - (remove local IRawPost)

  PROMPT TEMPLATES:
    KOL_CRAWL_PROMPT_TEMPLATE     -- ~15 lines (was ~40)
    BATCH_KOL_CRAWL_PROMPT_TEMPLATE -- ~18 lines (was ~70)

  NEW FUNCTION:
    processBatchCrawlResult(taskResult, handles) -> ICrawlResult[]

  MODIFIED FUNCTION:
    crawlAllKolsSequential() -- use parseBatchCrawlResult instead of inline parsing
```

## Related Code Files

- **Modify:** `src/services/kolCrawlerService.ts`
- **Import from:** `src/utils/kolCrawlScript.ts` (Phase 1)
- **Import from:** `src/utils/kolCrawlResultParser.ts` (Phase 2)

## Implementation Steps

### Step 1: Add new imports (top of file)

Add after existing imports (line 10):

```typescript
import { KOL_TWEET_SCRIPT, KOL_COMMENT_SCRIPT } from "../utils/kolCrawlScript.js";
import {
  parseBatchCrawlResult,
  parseSingleCrawlResult,
  type IRawPost,
} from "../utils/kolCrawlResultParser.js";
```

### Step 2: Replace `KOL_CRAWL_PROMPT_TEMPLATE` (lines 70-108)

Replace the entire template with:

```typescript
const KOL_CRAWL_PROMPT_TEMPLATE = `1. Navigate to https://x.com/{{handle}}, wait 8s, scroll 3x (2s each).
2. Run TWEET_SCRIPT via page.evaluate(), collect posts array.
3. For each post where comments > 10 (max 5 posts):
   a. Navigate to post_url, wait 4s
   b. Run COMMENT_SCRIPT via page.evaluate(), add result as top_comments on that post
   c. Navigate back
4. Return JSON: {"posts": <posts array with top_comments populated>}

TWEET_SCRIPT:
\`\`\`
${KOL_TWEET_SCRIPT}
\`\`\`

COMMENT_SCRIPT:
\`\`\`
${KOL_COMMENT_SCRIPT}
\`\`\`
${OUTPUT_FORMAT_INSTRUCTION}`;
```

### Step 3: Replace `BATCH_KOL_CRAWL_PROMPT_TEMPLATE` (lines 110-181)

Replace with:

```typescript
const BATCH_KOL_CRAWL_PROMPT_TEMPLATE = `For each handle below, sequentially:
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

COMMENT_SCRIPT:
\`\`\`
${KOL_COMMENT_SCRIPT}
\`\`\`

Return JSON: {"results": [{"handle": "...", "posts": [...]}]}
${OUTPUT_FORMAT_INSTRUCTION}`;
```

### Step 4: Remove local `IRawPost` interface (lines 255-270)

Delete the entire `IRawPost` interface block. It's now imported from `kolCrawlResultParser.ts`.

**Important:** Keep the `IComment` interface (lines 61-66) -- it's separate and still used locally.

### Step 5: Add `processBatchCrawlResult()` function

Add this new exported function after `processCrawlResults()` (after line 326):

```typescript
/**
 * Process a completed batch crawl task result.
 * Parses JSON, looks up KolProfiles, saves posts per handle.
 * Called by POST /api/tasks/:id/process-result endpoint.
 */
export async function processBatchCrawlResult(
  taskResult: string,
  handles: string[],
): Promise<ICrawlResult[]> {
  const batchResults = parseBatchCrawlResult(taskResult);
  const results: ICrawlResult[] = [];

  for (const { handle, posts } of batchResults) {
    try {
      const kol = await KolProfile.findOne({ handle });
      if (!kol) {
        log.warn(`[KolCrawler] processBatchCrawlResult: handle "${handle}" not found in KolProfile`);
        continue;
      }

      const { saved, skipped } = await processCrawlResults(kol._id, posts);

      // Update last_crawled_at
      const now = new Date();
      kol.last_crawled_at = now;
      await kol.save();
      await setCachedLastCrawled(kol.handle, now);

      results.push({
        kolId: kol._id,
        handle: kol.handle,
        postsFound: posts.length,
        postsSaved: saved,
        errors: [],
      });

      log.info(`[KolCrawler] @${handle}: ${posts.length} found, ${saved} saved, ${skipped} skipped`);
    } catch (error) {
      log.error(`[KolCrawler] Failed processing @${handle}: ${(error as Error).message}`);
      results.push({
        kolId: "",
        handle,
        postsFound: 0,
        postsSaved: 0,
        errors: [(error as Error).message],
      });
    }
  }

  // Log handles that were expected but missing from results
  const processedHandles = new Set(batchResults.map((r) => r.handle));
  for (const h of handles) {
    if (!processedHandles.has(h)) {
      log.warn(`[KolCrawler] Handle "${h}" was expected but missing from batch result`);
    }
  }

  return results;
}
```

### Step 6: Refactor `crawlAllKolsSequential()` inline parsing

Replace the inline JSON parsing block in `crawlAllKolsSequential()` (lines 591-622) with a call to the new function:

**Replace this block** (lines 591-622):
```typescript
  if (taskResult.result) {
    try {
      const parsed = JSON.parse(taskResult.result);
      if (parsed.results && Array.isArray(parsed.results)) {
        // ... 25 lines of inline parsing ...
      }
    } catch (parseError) {
      log.error(`[KolCrawler] Failed to parse batch results: ${(parseError as Error).message}`);
    }
  }
```

**With:**
```typescript
  if (taskResult.result) {
    try {
      const handles = kols.map((k) => k.handle);
      const processed = await processBatchCrawlResult(taskResult.result, handles);
      results.push(...processed);
    } catch (error) {
      log.error(`[KolCrawler] Failed to process batch results: ${(error as Error).message}`);
    }
  }
```

### Step 7: Simplify `createBatchCrawlTask()` prompt construction

The existing `createBatchCrawlTask()` (lines 193-222) builds `kolListFormatted` with per-KOL since/limit info. Since the new prompt just uses a flat handle list, simplify:

**Replace** the `kolListFormatted` and prompt construction (lines 196-203):
```typescript
  const handleList = kols.map((k) => `@${k.handle}`).join(", ");

  const prompt = BATCH_KOL_CRAWL_PROMPT_TEMPLATE
    .replace(/\{\{handleList\}\}/g, handleList);
```

The `{{kolCount}}` and `{{limit}}` placeholders are no longer in the new template -- remove their replacements.

### Step 8: Verify compilation

```bash
npx tsc --noEmit
```

## Todo List

- [ ] Add new imports for scripts and parser
- [ ] Replace `KOL_CRAWL_PROMPT_TEMPLATE` with JS-injection version
- [ ] Replace `BATCH_KOL_CRAWL_PROMPT_TEMPLATE` with JS-injection version
- [ ] Remove local `IRawPost` interface (keep `IComment`)
- [ ] Add `processBatchCrawlResult()` exported function
- [ ] Refactor `crawlAllKolsSequential()` to use `processBatchCrawlResult()`
- [ ] Simplify `createBatchCrawlTask()` prompt construction
- [ ] Verify `npx tsc --noEmit` passes
- [ ] Verify no other files import `IRawPost` from this service (grep check)

## Success Criteria

- Prompt templates are < 20 lines each (excluding embedded scripts)
- `processBatchCrawlResult()` is exported and callable
- `crawlAllKolsSequential()` delegates to `processBatchCrawlResult()` (no inline JSON.parse)
- All existing exports unchanged: `processCrawlResults`, `KolCrawlerService`, `crawlAllKolsSequential`, `ICrawlResult`
- TypeScript compiles without errors
- No duplicate `IRawPost` definitions

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Other files import `IRawPost` from service | Low | Grep for `IRawPost` across codebase before removing |
| Prompt format confuses OpenClaw | Low | Test with single KOL crawl first |
| `setCachedLastCrawled` is private | None | It's module-scoped, accessible within same file |

## Security Considerations

- Prompt content is server-generated, no user input interpolation
- `processBatchCrawlResult` uses parser that validates JSON shape before processing

## Next Steps

- Phase 4 adds the endpoint that calls `processBatchCrawlResult()`
