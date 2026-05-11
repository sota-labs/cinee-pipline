# Phase 1: Update KOL_TWEET_SCRIPT to accept sinceTimestamp

## Overview

- **File:** `src/utils/kolCrawlScript.ts`
- **Priority:** High (Phase 2 depends on this)
- **Effort:** ~15 min

## Change

Convert `KOL_TWEET_SCRIPT` from a self-invoking IIFE to a plain function expression so that `page.evaluate(fn, sinceTimestamp)` can pass the timestamp as an argument.

### Before

```js
export const KOL_TWEET_SCRIPT = `
(function() {
  function parseCount(str) { ... }
  const tweets = [...document.querySelectorAll('[data-testid="tweet"]')];
  return tweets.map(t => { ... }).filter(p => p.content && p.post_url);
})()
`;
```

### After

```js
export const KOL_TWEET_SCRIPT = `
(function(sinceTimestamp) {
  const sinceDate = sinceTimestamp ? new Date(sinceTimestamp) : null;
  function parseCount(str) { ... }
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
  }).filter(p =>
    p.content &&
    p.post_url &&
    (!sinceDate || !p.posted_at || new Date(p.posted_at) > sinceDate)
  );
})
`;
```

### Key differences

1. Outer `(function() { ... })()` → `(function(sinceTimestamp) { ... })` — no self-invoke, agent passes arg
2. `sinceDate` computed from param at top of function
3. `.filter()` adds timestamp guard: keep post if no `sinceDate`, no `posted_at`, or `posted_at > sinceDate`

## Filter Logic Detail

```js
(!sinceDate || !p.posted_at || new Date(p.posted_at) > sinceDate)
```

| sinceDate | posted_at | Result |
|-----------|-----------|--------|
| null | any | keep (no filter) |
| set | empty/missing | keep (safe default) |
| set | valid, newer | keep |
| set | valid, older | drop |

## Todo

- [ ] Remove self-invocation `()` at the end of the string
- [ ] Add `sinceTimestamp` parameter to outer function signature
- [ ] Add `sinceDate` variable declaration at top of function body
- [ ] Update `.filter()` to include timestamp guard
- [ ] Verify `KOL_COMMENT_SCRIPT` is unchanged (no timestamp logic needed there)

## Success Criteria

- `KOL_TWEET_SCRIPT` is a function expression (not IIFE) that accepts `sinceTimestamp`
- Posts with `posted_at` older than `sinceTimestamp` are filtered out by the script
- Missing `posted_at` → post is kept (safe default)
- `KOL_COMMENT_SCRIPT` is untouched
