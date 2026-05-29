---
phase: 03
title: Result Mapper
status: pending
priority: high
blockedBy: phase-02
---

# Phase 03 — Result Mapper

## Context Links

- Spec: `plans/260529-1500-x-api-hybrid-platform-architecture/spec.md`
- Plan: `plans/260529-1500-x-api-hybrid-platform-architecture/plan.md`
- Phase 02: `plans/260529-1500-x-api-hybrid-platform-architecture/phase-02-x-api-client.md`
- IRawPost interface: `src/utils/kolCrawlResultParser.ts`

## Overview

- Priority: high
- Status: pending (blocked by phase-02)
- Create `src/services/platforms/x/xResultMapper.ts` — maps X API v2 tweet objects to `IRawPost` format that `processCrawlResults()` already expects.

## Key Insights

- `IRawPost` is defined in `src/utils/kolCrawlResultParser.ts` — import from there
- `post_url` format: `https://x.com/${handle}/status/${tweet.id}`
- `is_retweet`: `tweet.referenced_tweets?.some(r => r.type === 'retweeted')`
- `is_quote`: `tweet.referenced_tweets?.some(r => r.type === 'quoted')`
- `quoted_post_url`: resolve from `referenced_tweets` where type=`quoted` — need author handle from `includes.users`
- Media URLs: `tweet.attachments?.media_keys` → look up in `includes.media[]` by `media_key` → use `url` field
- `impression_count` may be absent — default to 0 silently
- `top_comments` not populated by mapper — comment crawl is a separate phase (getTweetReplies)

## Requirements

- `mapTweetToPost(tweet, handle, includes?)` → `IRawPost`
- `mapRepliesToComments(tweets, includes?)` → `IComment[]` (matches `IComment` from kolCrawlerService)
- All metric fields default to 0 if missing (no throws on absent data)
- Media URL resolution from `includes.media` array
- Retweet and quote tweet detection via `referenced_tweets`

## Architecture

```
xResultMapper.ts
  import { IRawPost } from '../../utils/kolCrawlResultParser.js'
  import { IComment } from '../kolCrawlerService.js'
  import { XApiTweet, XApiMedia, XApiUser } from './xApiClient.js'

  interface XApiIncludes { media?: XApiMedia[]; users?: XApiUser[] }

  export function mapTweetToPost(
    tweet: XApiTweet,
    handle: string,
    includes?: XApiIncludes
  ): IRawPost

  export function mapRepliesToComments(
    tweets: XApiTweet[],
    includes?: XApiIncludes
  ): IComment[]
```

## Related Code Files

- Create: `src/services/platforms/x/xResultMapper.ts`
- Reads (types only): `src/utils/kolCrawlResultParser.ts` (IRawPost)
- Reads (types only): `src/services/kolCrawlerService.ts` (IComment)
- Reads (types only): `src/services/platforms/x/xApiClient.ts` (XApiTweet, XApiMedia, XApiUser)

## Implementation Steps

1. Create `src/services/platforms/x/xResultMapper.ts`.
2. Import `IRawPost` from `../../utils/kolCrawlResultParser.js`.
3. Import `IComment` from `../kolCrawlerService.js`.
4. Import `XApiTweet`, `XApiMedia`, `XApiUser` from `./xApiClient.js`.
5. Define `XApiIncludes` interface locally.
6. Implement `resolveMediaUrls(mediaKeys, includes)` private helper:
   - If no `mediaKeys` or no `includes.media`, return `[]`
   - Map each key to matching `includes.media` entry, return `url` values (filter undefined)
7. Implement `mapTweetToPost(tweet, handle, includes?)`:
   - `post_url`: `https://x.com/${handle}/status/${tweet.id}`
   - `content`: `tweet.text`
   - `posted_at`: `tweet.created_at`
   - `likes`: `tweet.public_metrics?.like_count ?? 0`
   - `comments`: `tweet.public_metrics?.reply_count ?? 0`
   - `retweets`: `tweet.public_metrics?.retweet_count ?? 0`
   - `views`: `tweet.public_metrics?.impression_count ?? 0`
   - `media_urls`: call `resolveMediaUrls`
   - `is_retweet`: check `referenced_tweets` for type `'retweeted'`
   - `is_quote`: check `referenced_tweets` for type `'quoted'`
   - `quoted_post_url`: if quote tweet, build URL from referenced tweet id + author username from includes
8. Implement `mapRepliesToComments(tweets, includes?)`:
   - For each tweet, find author username from `includes.users` by `author_id`
   - Return `IComment[]` with `content`, `author_handle`, `likes`, `reply_count`
9. Run `npm run build` to verify no TypeScript errors.

## Todo List

- [ ] Create `src/services/platforms/x/xResultMapper.ts`
- [ ] Import IRawPost, IComment, XApiTweet types
- [ ] Implement `resolveMediaUrls` helper
- [ ] Implement `mapTweetToPost` with all field mappings
- [ ] Implement `mapRepliesToComments`
- [ ] Handle missing `impression_count` (default 0)
- [ ] Handle quote tweet URL resolution
- [ ] Verify `npm run build` passes

## Success Criteria

- `mapTweetToPost` returns valid `IRawPost` for normal tweet, retweet, quote tweet, and tweet with media
- Missing `public_metrics` fields default to 0 (no runtime errors)
- `is_retweet: true` when `referenced_tweets` contains `type: 'retweeted'`
- `media_urls` populated from `includes.media` when `attachments.media_keys` present
- `mapRepliesToComments` returns `author_handle` from `includes.users` lookup

## Risk Assessment

- `quoted_post_url` author resolution requires `includes.users` — if absent, omit the field (non-fatal)
- X API may return `text` with `RT @handle:` prefix for retweets — mapper doesn't strip it (processCrawlResults drops retweets anyway via `shouldDropAtCrawl`)

## Security Considerations

- No external calls — pure data transformation
- Input is typed — no `any` usage

## Next Steps

- Phase 04 imports `mapTweetToPost` and `mapRepliesToComments` from this file
- Phase 05 tests this file with fixture API responses
