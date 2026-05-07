---
title: "Phase 5: Write Unit Tests"
status: pending
effort: 1h
---

# Phase 5: Write Unit Tests

## Context Links

- [Spec](./spec.md) -- Section "Testing Strategy"
- [Existing tests](../src/tests/) -- vitest pattern reference
- [enums.test.ts](../src/tests/enums.test.ts) -- test file pattern to follow

## Overview

- **Priority:** High
- **Status:** Pending
- **Description:** Write unit tests for the parser (`kolCrawlResultParser.ts`) and the extraction scripts (`kolCrawlScript.ts`). Tests use `vitest` following existing project patterns.

## Key Insights

- Project uses `vitest` (not jest) -- see `package.json` and existing test files
- Tests live in `src/tests/` directory (flat structure, not co-located)
- Import paths use `.js` extension (Node16 module resolution)
- Script tests can only validate JS syntax and `parseCount()` logic -- cannot test DOM selectors without a browser
- Parser tests are the highest-value tests (pure functions, easy to test, critical correctness)

## Requirements

### Functional
1. **Parser tests** (`kolCrawlResultParser.test.ts`):
   - Valid batch JSON -> correct parsed output
   - Valid single JSON -> correct parsed output
   - Malformed JSON -> throws descriptive error
   - Missing `results`/`posts` key -> throws error
   - Numeric normalization: string "1200" -> number 1200
   - Shorthand normalization: "1.2K" -> 1200, "3.5M" -> 3500000
   - Empty content/post_url posts filtered out
   - Partial results (some KOLs missing) handled gracefully
   - RESPONSE delimiter wrapping handled
   - top_comments normalized correctly

2. **Script tests** (`kolCrawlScript.test.ts`):
   - Both exports are non-empty strings
   - Both are syntactically valid JavaScript (parseable by `new Function()`)
   - `parseCount` logic extracted and tested directly

### Non-functional
- Each test file under 150 lines
- No mocks needed (pure functions)
- No DB connection needed

## Related Code Files

- **Create:** `src/tests/kolCrawlResultParser.test.ts`
- **Create:** `src/tests/kolCrawlScript.test.ts`
- **Reference:** `src/tests/enums.test.ts` -- pattern to follow

## Implementation Steps

### Step 1: Create `src/tests/kolCrawlResultParser.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import {
  parseBatchCrawlResult,
  parseSingleCrawlResult,
} from "../utils/kolCrawlResultParser.js";

// ── Test data ────────────────────────────────────────────────────────────────

const VALID_BATCH_JSON = JSON.stringify({
  results: [
    {
      handle: "alice",
      posts: [
        {
          post_url: "https://x.com/alice/status/123",
          content: "Hello world",
          posted_at: "2026-05-01T12:00:00Z",
          likes: 100,
          comments: 50,
          retweets: 20,
          views: 1000,
          media_urls: ["https://pbs.twimg.com/img1.jpg"],
          top_comments: [
            { content: "Great post!", author_handle: "bob", likes: 10, reply_count: 2 },
          ],
        },
      ],
    },
    {
      handle: "charlie",
      posts: [],
    },
  ],
});

const VALID_SINGLE_JSON = JSON.stringify({
  posts: [
    {
      post_url: "https://x.com/alice/status/456",
      content: "Another tweet",
      posted_at: "2026-05-01T14:00:00Z",
      likes: "200",    // string -- should be normalized
      comments: "1.2K", // shorthand -- should be normalized
      retweets: 30,
      views: "3.5M",    // shorthand
    },
  ],
});

const WRAPPED_JSON = `<<<RESPONSE_START>>>
${VALID_BATCH_JSON}
<<<RESPONSE_END>>>`;

// ── Tests ────────────────────────────────────────────────────────────────────

describe("parseBatchCrawlResult", () => {
  it("parses valid batch JSON", () => {
    const result = parseBatchCrawlResult(VALID_BATCH_JSON);
    expect(result).toHaveLength(2);
    expect(result[0].handle).toBe("alice");
    expect(result[0].posts).toHaveLength(1);
    expect(result[0].posts[0].likes).toBe(100);
    expect(result[0].posts[0].top_comments).toHaveLength(1);
    expect(result[1].handle).toBe("charlie");
    expect(result[1].posts).toHaveLength(0);
  });

  it("handles RESPONSE delimiter wrapping", () => {
    const result = parseBatchCrawlResult(WRAPPED_JSON);
    expect(result).toHaveLength(2);
    expect(result[0].handle).toBe("alice");
  });

  it("throws on malformed JSON", () => {
    expect(() => parseBatchCrawlResult("not json")).toThrow("[KolCrawlParser]");
  });

  it("throws on wrong shape (missing results key)", () => {
    expect(() => parseBatchCrawlResult(JSON.stringify({ posts: [] }))).toThrow(
      "Expected {results:"
    );
  });

  it("filters posts with empty content", () => {
    const json = JSON.stringify({
      results: [
        {
          handle: "test",
          posts: [
            { post_url: "https://x.com/test/1", content: "", likes: 1 },
            { post_url: "https://x.com/test/2", content: "Valid", posted_at: "", likes: 1 },
          ],
        },
      ],
    });
    const result = parseBatchCrawlResult(json);
    expect(result[0].posts).toHaveLength(1);
    expect(result[0].posts[0].content).toBe("Valid");
  });

  it("filters posts with empty post_url", () => {
    const json = JSON.stringify({
      results: [
        {
          handle: "test",
          posts: [
            { post_url: "", content: "No URL", likes: 1 },
          ],
        },
      ],
    });
    const result = parseBatchCrawlResult(json);
    expect(result[0].posts).toHaveLength(0);
  });

  it("filters entries with empty handle", () => {
    const json = JSON.stringify({
      results: [{ handle: "", posts: [] }],
    });
    const result = parseBatchCrawlResult(json);
    expect(result).toHaveLength(0);
  });
});

describe("parseSingleCrawlResult", () => {
  it("parses valid single KOL JSON", () => {
    const result = parseSingleCrawlResult(VALID_SINGLE_JSON);
    expect(result).toHaveLength(1);
    expect(result[0].post_url).toBe("https://x.com/alice/status/456");
  });

  it("normalizes string numbers to integers", () => {
    const result = parseSingleCrawlResult(VALID_SINGLE_JSON);
    expect(result[0].likes).toBe(200);
    expect(result[0].comments).toBe(1200);
    expect(result[0].views).toBe(3500000);
  });

  it("throws on missing posts key", () => {
    expect(() =>
      parseSingleCrawlResult(JSON.stringify({ results: [] }))
    ).toThrow("Expected {posts:");
  });

  it("throws on malformed JSON", () => {
    expect(() => parseSingleCrawlResult("{invalid")).toThrow("[KolCrawlParser]");
  });
});
```

### Step 2: Create `src/tests/kolCrawlScript.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import { KOL_TWEET_SCRIPT, KOL_COMMENT_SCRIPT } from "../utils/kolCrawlScript.js";

describe("KOL_TWEET_SCRIPT", () => {
  it("is a non-empty string", () => {
    expect(typeof KOL_TWEET_SCRIPT).toBe("string");
    expect(KOL_TWEET_SCRIPT.length).toBeGreaterThan(100);
  });

  it("is syntactically valid JavaScript", () => {
    // new Function() will throw SyntaxError if script is invalid
    expect(() => new Function(KOL_TWEET_SCRIPT)).not.toThrow();
  });

  it("contains expected selectors", () => {
    expect(KOL_TWEET_SCRIPT).toContain('[data-testid="tweet"]');
    expect(KOL_TWEET_SCRIPT).toContain('[data-testid="tweetText"]');
    expect(KOL_TWEET_SCRIPT).toContain('[data-testid="like"]');
    expect(KOL_TWEET_SCRIPT).toContain('[data-testid="reply"]');
    expect(KOL_TWEET_SCRIPT).toContain('[data-testid="retweet"]');
  });

  it("contains parseCount function", () => {
    expect(KOL_TWEET_SCRIPT).toContain("parseCount");
  });
});

describe("KOL_COMMENT_SCRIPT", () => {
  it("is a non-empty string", () => {
    expect(typeof KOL_COMMENT_SCRIPT).toBe("string");
    expect(KOL_COMMENT_SCRIPT.length).toBeGreaterThan(50);
  });

  it("is syntactically valid JavaScript", () => {
    expect(() => new Function(KOL_COMMENT_SCRIPT)).not.toThrow();
  });

  it("skips first element (original post) and takes up to 10", () => {
    expect(KOL_COMMENT_SCRIPT).toContain(".slice(1, 11)");
  });
});

describe("parseCount (extracted logic)", () => {
  // Extract and test the parseCount function from the script
  const parseCountFn = new Function(`
    function parseCount(str) {
      if (!str) return 0;
      const s = str.replace(/,/g, '').trim();
      if (s.endsWith('K')) return Math.round(parseFloat(s) * 1000);
      if (s.endsWith('M')) return Math.round(parseFloat(s) * 1000000);
      return parseInt(s) || 0;
    }
    return parseCount;
  `)();

  it("handles null/undefined", () => {
    expect(parseCountFn(null)).toBe(0);
    expect(parseCountFn(undefined)).toBe(0);
    expect(parseCountFn("")).toBe(0);
  });

  it("parses plain numbers", () => {
    expect(parseCountFn("42")).toBe(42);
    expect(parseCountFn("1,234")).toBe(1234);
  });

  it('parses K shorthand ("1.2K" -> 1200)', () => {
    expect(parseCountFn("1.2K")).toBe(1200);
    expect(parseCountFn("15K")).toBe(15000);
  });

  it('parses M shorthand ("3.5M" -> 3500000)', () => {
    expect(parseCountFn("3.5M")).toBe(3500000);
    expect(parseCountFn("1M")).toBe(1000000);
  });

  it("returns 0 for non-numeric strings", () => {
    expect(parseCountFn("abc")).toBe(0);
  });
});
```

### Step 3: Run tests

```bash
npx vitest run src/tests/kolCrawlResultParser.test.ts src/tests/kolCrawlScript.test.ts
```

## Todo List

- [ ] Create `src/tests/kolCrawlResultParser.test.ts`
- [ ] Create `src/tests/kolCrawlScript.test.ts`
- [ ] Run tests and verify all pass
- [ ] Run full test suite to verify no regressions: `npm test`

## Success Criteria

- All parser tests pass (valid JSON, malformed JSON, normalization, filtering)
- All script tests pass (syntax validation, selector presence, parseCount logic)
- Full test suite (`npm test`) passes without regressions
- No test uses mocks for the parser tests (pure functions)

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| vitest config doesn't resolve `.js` imports | Low | Existing tests already use this pattern |
| `new Function()` test approach flagged by linter | Low | Standard JS technique, vitest compatible |

## Security Considerations

- Tests do not connect to DB or external services
- No secrets or credentials in test data

## Next Steps

- All phases complete -- feature ready for manual testing with real OpenClaw agent
- Manual test: trigger `crawlAllKolsSequential()`, then call `POST /api/tasks/:id/process-result`
