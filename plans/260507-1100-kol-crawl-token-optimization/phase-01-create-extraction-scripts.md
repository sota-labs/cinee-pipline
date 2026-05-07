---
title: "Phase 1: Create Static JS Extraction Scripts"
status: pending
effort: 1h
---

# Phase 1: Create Static JS Extraction Scripts

## Context Links

- [Spec](./spec.md) -- Section "1. Static JS Extraction Scripts"
- [KolPost model](../src/db/models/KolPost.ts) -- target schema for extracted data

## Overview

- **Priority:** Critical -- all other phases depend on this
- **Status:** Pending
- **Description:** Create `src/utils/kolCrawlScript.ts` containing two static JavaScript strings (`KOL_TWEET_SCRIPT` and `KOL_COMMENT_SCRIPT`) that run inside Twitter/X browser context via `page.evaluate()`.

## Key Insights

- Scripts run in **browser context**, not Node.js -- no imports, no TypeScript, no external dependencies
- Twitter uses `data-testid` attributes as stable selectors (more reliable than class names)
- Number parsing must handle shorthand: "1.2K" -> 1200, "3.5M" -> 3500000
- Content should be truncated (500 chars for tweets, 300 for comments) to keep payload size small
- Both scripts are IIFEs that return arrays directly

## Requirements

### Functional
- `KOL_TWEET_SCRIPT`: Extract all visible tweets from a profile page timeline
- `KOL_COMMENT_SCRIPT`: Extract top 10 comments from a tweet detail page (skip index 0 = original tweet)
- Both scripts must return arrays of plain objects (serializable to JSON)

### Non-functional
- Scripts must be pure JS strings (no template literals that reference Node vars at runtime)
- Combined size of both scripts < 2KB to keep task.prompt lean

## Architecture

```
src/utils/kolCrawlScript.ts
  |-- KOL_TWEET_SCRIPT (string)   -> returns IRawPost[] shape
  |-- KOL_COMMENT_SCRIPT (string) -> returns IComment[] shape
```

Both are `export const` string literals. They embed a `parseCount()` helper as an IIFE-local function.

## Related Code Files

- **Create:** `src/utils/kolCrawlScript.ts`
- **Reference (read-only):** `src/db/models/KolPost.ts` (ITopComment, IKolPost shapes)
- **Reference (read-only):** `src/services/kolCrawlerService.ts` (IRawPost, IComment interfaces)

## Implementation Steps

### Step 1: Create `src/utils/kolCrawlScript.ts`

```typescript
/**
 * Static JS scripts for Twitter/X DOM extraction.
 * Run inside browser via OpenClaw's page.evaluate().
 * IMPORTANT: These are raw JS strings -- no TypeScript, no imports.
 */

export const KOL_TWEET_SCRIPT = `
(function() {
  function parseCount(str) {
    if (!str) return 0;
    const s = str.replace(/,/g, '').trim();
    if (s.endsWith('K')) return Math.round(parseFloat(s) * 1000);
    if (s.endsWith('M')) return Math.round(parseFloat(s) * 1000000);
    return parseInt(s) || 0;
  }
  const tweets = [...document.querySelectorAll('[data-testid="tweet"]')];
  return tweets.map(t => {
    const timeEl = t.querySelector('time');
    const linkEl = timeEl?.closest('a');
    return {
      post_url: linkEl ? 'https://x.com' + linkEl.getAttribute('href') : '',
      content: t.querySelector('[data-testid="tweetText"]')?.innerText?.slice(0, 500) || '',
      posted_at: timeEl?.getAttribute('datetime') || '',
      likes: parseCount(t.querySelector('[data-testid="like"] span')?.innerText),
      comments: parseCount(t.querySelector('[data-testid="reply"] span')?.innerText),
      retweets: parseCount(t.querySelector('[data-testid="retweet"] span')?.innerText),
      views: parseCount(t.querySelector('[data-testid="analytics"] span')?.innerText),
      media_urls: [...t.querySelectorAll('[data-testid="tweetPhoto"] img, [data-testid="videoPlayer"] video')]
                    .map(el => el.src || el.poster).filter(Boolean),
    };
  }).filter(p => p.content && p.post_url);
})()
`;

export const KOL_COMMENT_SCRIPT = `
(function() {
  function parseCount(str) {
    if (!str) return 0;
    const s = str.replace(/,/g, '').trim();
    if (s.endsWith('K')) return Math.round(parseFloat(s) * 1000);
    if (s.endsWith('M')) return Math.round(parseFloat(s) * 1000000);
    return parseInt(s) || 0;
  }
  const items = [...document.querySelectorAll('[data-testid="tweet"]')].slice(1, 11);
  return items.map(c => ({
    content: c.querySelector('[data-testid="tweetText"]')?.innerText?.slice(0, 300) || '',
    author_handle: (c.querySelector('[data-testid="User-Name"] a')?.href || '').split('/').pop() || '',
    likes: parseCount(c.querySelector('[data-testid="like"] span')?.innerText),
    reply_count: parseCount(c.querySelector('[data-testid="reply"] span')?.innerText),
  })).filter(c => c.content);
})()
`;
```

### Step 2: Verify the scripts are valid JavaScript

After creating the file, test that both strings parse as valid JS:

```bash
node -e "new Function(require('./src/utils/kolCrawlScript.js').KOL_TWEET_SCRIPT)"
```

This won't execute DOM code (no `document`), but confirms no syntax errors.

## Todo List

- [ ] Create `src/utils/kolCrawlScript.ts` with both script constants
- [ ] Verify scripts have no syntax errors via `node -e "new Function(...)"`
- [ ] Confirm file compiles with `npx tsc --noEmit`

## Success Criteria

- File exists at `src/utils/kolCrawlScript.ts`
- Both exports (`KOL_TWEET_SCRIPT`, `KOL_COMMENT_SCRIPT`) are non-empty strings
- Both scripts are syntactically valid JavaScript
- TypeScript compiles without errors
- `KOL_TWEET_SCRIPT` returns objects matching `IRawPost` shape (post_url, content, posted_at, likes, comments, retweets, views, media_urls)
- `KOL_COMMENT_SCRIPT` returns objects matching `IComment` shape (content, author_handle, likes, reply_count)

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Twitter changes `data-testid` values | Medium | All selectors centralized here; single-file fix |
| `parseCount` misses edge cases (e.g., "1.2B") | Low | Add "B" handling if needed; current KOLs unlikely to have billions |
| `innerText` vs `textContent` differences | Low | `innerText` preferred (renders visible text, skips hidden elements) |

## Security Considerations

- Scripts run in browser sandbox (page.evaluate) -- no server-side code execution risk
- No user input interpolated into scripts -- they are static strings

## Next Steps

- Phase 2 needs these exports to define expected output types
- Phase 3 embeds these scripts into prompt templates
