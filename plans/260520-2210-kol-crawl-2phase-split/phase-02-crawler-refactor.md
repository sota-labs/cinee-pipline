---
phase: 2
priority: high
effort: medium
---

# Phase 2: Crawler Refactor

## File

- `src/services/kolCrawlerService.ts`

---

## 2a. Reduce wait times in BATCH_KOL_CRAWL_PROMPT_TEMPLATE

| Step | Before | After |
|------|--------|-------|
| Profile load wait | 8s | 4s |
| Scroll wait | 2s each | 1s each |
| Scroll count | 3x | 2x |
| Between handles | 10s | 5s |

Remove all comment crawl steps (step 3 a/b/c) from the prompt entirely.

New prompt structure:
```
For each handle below, sequentially:
1. Navigate to https://x.com/{handle}, wait 4s, scroll 2x (1s each)
2. Run TWEET_SCRIPT via page.evaluate(TWEET_SCRIPT, sinceTimestamp)
   - STOP scrolling if any visible post has posted_at <= sinceTimestamp
3. Wait 5s before next handle

Handles:
{{handleList}}

TWEET_SCRIPT (call as: page.evaluate(TWEET_SCRIPT, sinceTimestamp)):
```${KOL_TWEET_SCRIPT_BATCH}```

Return JSON: {"results": [{"handle": "...", "posts": [...]}]}
```

---

## 2b. Add COMMENT_CRAWL_PROMPT_TEMPLATE

New prompt for Phase 2 task:

```typescript
const COMMENT_CRAWL_PROMPT_TEMPLATE = `For each post below, sequentially:
1. Navigate to post_url, wait 3s
2. Run COMMENT_SCRIPT via page.evaluate(), collect comments array
3. PATCH {{API}}/api/kol-posts/{{postId}}/comments with body: {"top_comments": <comments array>}
4. Wait 2s before next post

Posts:
{{postList}}

COMMENT_SCRIPT:
\`\`\`
${KOL_COMMENT_SCRIPT}
\`\`\`

Return JSON: {"results": [{"postId": "...", "comments_count": N}]}
${OUTPUT_FORMAT_INSTRUCTION}`;
```

`{{postList}}` format per line:
```
- postId: {id} | post_url: {url}
```

---

## 2c. Add createCommentCrawlTask()

```typescript
async function createCommentCrawlTask(
  posts: Array<{ id: string; post_url: string }>
): Promise<string> {
  const postList = posts
    .map(p => `- postId: ${p.id} | post_url: ${p.post_url}`)
    .join("\n");

  const prompt = COMMENT_CRAWL_PROMPT_TEMPLATE
    .replace(/\{\{postList\}\}/g, postList)
    .replace(/\{\{API\}\}/g, API);

  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  const command = `agent --agent ${settings.openClawAgent} --message '${escapedPrompt}'`;

  const task = await Task.create({
    type: ETaskType.KOL_COMMENT_CRAWL,
    agent: settings.openClawAgent,
    prompt: command,
    status: ETaskStatus.PENDING,
    payload: {
      action: "comment_crawl",
      postCount: posts.length,
      postIds: posts.map(p => p.id),
    },
  });

  log.info(`[KolCrawler] Created comment crawl task for ${posts.length} posts: ${task._id}`);
  return String(task._id);
}
```

---

## 2d. Update processBatchCrawlResult() to trigger Phase 2

After saving posts to DB, collect posts with `comments > 10` and create Phase 2 task:

```typescript
// After existing post-save logic, add:
const postsNeedingComments = savedPosts
  .filter(p => p.comments > 10)
  .slice(0, 15); // max 15 posts across all handles (5 per handle × 3 handles max)

if (postsNeedingComments.length > 0) {
  await createCommentCrawlTask(
    postsNeedingComments.map(p => ({ id: String(p._id), post_url: p.post_url }))
  );
  log.info(`[KolCrawler] Queued comment crawl for ${postsNeedingComments.length} posts`);
}
```

`savedPosts` = array of saved `KolPost` documents returned from `processCrawlResults()`.

**Note**: `processCrawlResults()` currently returns `void` — change return type to `Promise<IKolPost[]>` and return the saved posts array.

---

## Todo

- [ ] Update `BATCH_KOL_CRAWL_PROMPT_TEMPLATE`: reduce wait times, remove comment steps
- [ ] Add `COMMENT_CRAWL_PROMPT_TEMPLATE` constant
- [ ] Add `createCommentCrawlTask(posts)` function
- [ ] Change `processCrawlResults()` return type to `Promise<IKolPost[]>`, return saved posts
- [ ] Update `processBatchCrawlResult()` to collect saved posts and call `createCommentCrawlTask()`
- [ ] Run `npx tsc --noEmit` to verify no type errors
