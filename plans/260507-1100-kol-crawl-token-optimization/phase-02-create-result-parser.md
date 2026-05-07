---
title: "Phase 2: Create Result Parser/Validator"
status: pending
effort: 1.5h
---

# Phase 2: Create Result Parser/Validator

## Context Links

- [Spec](./spec.md) -- Section "3. Result Validator/Normalizer"
- [extractResponse.ts](../src/utils/extractResponse.ts) -- reuse for delimiter extraction
- [outputFormat.ts](../src/prompts/outputFormat.ts) -- RESPONSE_DELIMITERS definition
- [kolCrawlerService.ts](../src/services/kolCrawlerService.ts) -- IRawPost interface (lines 255-270)

## Overview

- **Priority:** High -- Phase 3 depends on this
- **Status:** Pending
- **Description:** Create `src/utils/kolCrawlResultParser.ts` with two functions: `parseBatchCrawlResult()` and `parseSingleCrawlResult()`. They validate, normalize, and type-check raw JSON strings returned by OpenClaw.

## Key Insights

- OpenClaw wraps output in `<<<RESPONSE_START>>>` / `<<<RESPONSE_END>>>` delimiters -- reuse existing `extractResponse()` to strip these
- Numeric fields may arrive as strings (e.g., `"1200"` instead of `1200`) due to LLM formatting -- normalizer must coerce
- Partial results are valid (some KOLs missing from batch) -- process what's available, skip missing
- Empty posts array for a handle is valid (page didn't load / no tweets) -- not an error

## Requirements

### Functional
- `parseBatchCrawlResult(raw: string)`: Parse `{"results": [{handle, posts}]}` shape
- `parseSingleCrawlResult(raw: string)`: Parse `{"posts": [...]}` shape
- Both must extract JSON from RESPONSE delimiters first
- Both must normalize numeric fields to numbers
- Both must filter out posts with empty `content` or `post_url`
- Both must throw descriptive errors on invalid shape

### Non-functional
- No external validation library (Zod) -- keep it simple, manual shape checks
- Functions must be pure (no DB calls, no side effects)
- File stays under 120 lines

## Architecture

```
src/utils/kolCrawlResultParser.ts
  |-- IRawPost (interface, moved from kolCrawlerService.ts)
  |-- IBatchResult (interface, local)
  |-- parseBatchCrawlResult(raw) -> Array<{handle, posts}>
  |-- parseSingleCrawlResult(raw) -> IRawPost[]
  |-- normalizePost(post) -> IRawPost (private helper)
  |-- toNumber(val) -> number (private helper)
```

## Related Code Files

- **Create:** `src/utils/kolCrawlResultParser.ts`
- **Modify:** `src/services/kolCrawlerService.ts` -- remove `IRawPost` interface, import from parser instead
- **Reference:** `src/utils/extractResponse.ts` -- reuse `extractResponse()`

## Implementation Steps

### Step 1: Create `src/utils/kolCrawlResultParser.ts`

```typescript
/** Validate and normalize KOL crawl results from OpenClaw. */
import { extractResponse } from "./extractResponse.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IRawPost {
  post_url: string;
  content: string;
  posted_at: string;
  likes: number;
  comments: number;
  retweets: number;
  views: number;
  media_urls?: string[];
  top_comments?: Array<{
    content: string;
    author_handle: string;
    likes: number;
    reply_count: number;
  }>;
}

export interface IBatchKolResult {
  handle: string;
  posts: IRawPost[];
}

// ── Private helpers ────────────────────────────────────────────────────────────

/** Coerce a value to number. Handles strings like "1200", "1.2K" that slipped through. */
function toNumber(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val !== "string") return 0;
  const s = val.replace(/,/g, "").trim();
  if (s.endsWith("K")) return Math.round(parseFloat(s) * 1000);
  if (s.endsWith("M")) return Math.round(parseFloat(s) * 1000000);
  return parseInt(s, 10) || 0;
}

/** Normalize a single post object: coerce numerics, trim content, filter media. */
function normalizePost(raw: Record<string, unknown>): IRawPost {
  const topComments = Array.isArray(raw.top_comments)
    ? (raw.top_comments as Array<Record<string, unknown>>).map((c) => ({
        content: String(c.content || "").slice(0, 300),
        author_handle: String(c.author_handle || ""),
        likes: toNumber(c.likes),
        reply_count: toNumber(c.reply_count),
      })).filter((c) => c.content)
    : [];

  return {
    post_url: String(raw.post_url || ""),
    content: String(raw.content || "").slice(0, 500),
    posted_at: String(raw.posted_at || ""),
    likes: toNumber(raw.likes),
    comments: toNumber(raw.comments),
    retweets: toNumber(raw.retweets),
    views: toNumber(raw.views),
    media_urls: Array.isArray(raw.media_urls)
      ? (raw.media_urls as unknown[]).map(String).filter(Boolean)
      : [],
    ...(topComments.length > 0 ? { top_comments: topComments } : {}),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Parse batch crawl result: {"results": [{handle, posts}]}.
 * Extracts JSON from RESPONSE delimiters, validates shape, normalizes fields.
 * @throws Error if JSON is unparseable or shape is invalid.
 */
export function parseBatchCrawlResult(raw: string): IBatchKolResult[] {
  const jsonStr = extractResponse(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`[KolCrawlParser] Invalid JSON in batch result: ${jsonStr.slice(0, 200)}`);
  }

  const obj = parsed as Record<string, unknown>;
  if (!obj || !Array.isArray(obj.results)) {
    throw new Error(`[KolCrawlParser] Expected {results: [...]}, got: ${JSON.stringify(parsed).slice(0, 200)}`);
  }

  return (obj.results as Array<Record<string, unknown>>).map((entry) => {
    const handle = String(entry.handle || "");
    const rawPosts = Array.isArray(entry.posts) ? (entry.posts as Array<Record<string, unknown>>) : [];
    const posts = rawPosts
      .map(normalizePost)
      .filter((p) => p.content && p.post_url);

    return { handle, posts };
  }).filter((r) => r.handle);
}

/**
 * Parse single KOL crawl result: {"posts": [...]}.
 * @throws Error if JSON is unparseable or shape is invalid.
 */
export function parseSingleCrawlResult(raw: string): IRawPost[] {
  const jsonStr = extractResponse(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`[KolCrawlParser] Invalid JSON in single result: ${jsonStr.slice(0, 200)}`);
  }

  const obj = parsed as Record<string, unknown>;
  if (!obj || !Array.isArray(obj.posts)) {
    throw new Error(`[KolCrawlParser] Expected {posts: [...]}, got: ${JSON.stringify(parsed).slice(0, 200)}`);
  }

  return (obj.posts as Array<Record<string, unknown>>)
    .map(normalizePost)
    .filter((p) => p.content && p.post_url);
}
```

### Step 2: Update `kolCrawlerService.ts` imports

After creating the parser, update the service to import `IRawPost` from the parser instead of defining it locally. This is a preparation step that Phase 3 will complete. **For now, just note this dependency.**

The `IRawPost` interface in `kolCrawlerService.ts` (lines 255-270) is identical to the one in the parser. Phase 3 will:
1. Remove the local `IRawPost` definition from the service
2. Add `import { IRawPost } from "../utils/kolCrawlResultParser.js";`

## Todo List

- [ ] Create `src/utils/kolCrawlResultParser.ts` with full implementation
- [ ] Confirm `extractResponse` import path resolves correctly
- [ ] Verify TypeScript compiles: `npx tsc --noEmit`
- [ ] Test with sample JSON strings manually (Phase 5 adds formal tests)

## Success Criteria

- `parseBatchCrawlResult` correctly parses valid batch JSON
- `parseBatchCrawlResult` throws descriptive error on malformed JSON
- `parseSingleCrawlResult` correctly parses valid single-KOL JSON
- Numeric normalization works: string `"1200"` -> number `1200`
- Posts with empty content or post_url are filtered out
- `top_comments` are normalized and empty content comments filtered
- File compiles with no TypeScript errors

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| OpenClaw returns deeply nested/unexpected JSON | Low | `extractResponse` already handles delimiter extraction; parser validates top-level shape |
| Large result payloads (100+ posts) | Low | `slice(0, 500)` on content, no unbounded arrays |

## Security Considerations

- Input is `task.result` from DB -- already stored server-side, not direct user input
- JSON.parse is safe against prototype pollution when used with type narrowing (no `Object.assign`)

## Next Steps

- Phase 3 uses `parseBatchCrawlResult` in the new `processBatchCrawlResult()` function
- Phase 5 writes unit tests for both parser functions
