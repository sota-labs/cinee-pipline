# Phase 2: tools.ts Route Trigger

**Status:** Pending
**Priority:** High — webhook entry point for the self-reply flow
**Depends on:** Phase 1 (Reply model fields must exist)

## Context Links

- Spec: `plans/reports/spec-260518-self-reply-trigger.md` §3, §5
- Route file: `src/routes/tools.ts`
- selfReplyService: `src/services/selfReplyService.ts` (read-only reference)
- SelfReplyQueue model: `src/db/models/SelfReplyQueue.ts` (read-only reference)

## Overview

After `Reply.insertMany()` succeeds in `POST /api/tools/db/replies`, add a `setImmediate` block that inspects each saved reply. For replies with `status === "resolved"` and a `parent_post_url`, look up the matching `Post` and either create a new `SelfReplyQueue` or append to an existing one.

## File Ownership

- `src/routes/tools.ts`

## Requirements

### Functional
- Add `parseXUrl(url)` helper function (module-private, not exported)
- Add imports: `SelfReplyQueue` from `../db/index.js`, `selfReplyService` from `../services/selfReplyService.js`
- After `Reply.insertMany()`, trigger self-reply queue creation via `setImmediate`
- Skip replies with `status !== "resolved"` or missing `parent_post_url`
- Skip if `parseXUrl(reply.url)` returns null
- Skip if `Post.findOne({ post_url: reply.parent_post_url })` returns null (post not seeded yet)
- If `SelfReplyQueue` exists for the post: call `selfReplyService.addCommentToQueue()`
- If no queue exists: call `selfReplyService.createReplyQueue()`
- Errors inside `setImmediate` must be caught and logged — never crash the process

### Non-functional
- `setImmediate` ensures the HTTP response returns to the worker before queue logic runs
- No change to the HTTP response shape — still `{ success, inserted, replies }`

## Architecture

```
POST /api/tools/db/replies
  → Reply.insertMany(items)
  → res.json(...)          ← response sent immediately
  → setImmediate(async () => {
      for each reply where status==="resolved" && parent_post_url:
        parsed = parseXUrl(reply.url)   // { handle, tweetId } | null
        if !parsed → continue
        post = Post.findOne({ post_url: reply.parent_post_url })
        if !post → continue
        comment = { comment_id: parsed.tweetId, author_handle: reply.author_handle || parsed.handle, content: reply.reply_content, likes: 0 }
        existing = SelfReplyQueue.findOne({ our_post_id: post._id })
        if existing → selfReplyService.addCommentToQueue(existing._id, comment)
        else        → selfReplyService.createReplyQueue(post._id, post.post_url, [comment])
    })
```

## Implementation Steps

### 1. Add `parseXUrl` helper (top of file, after imports)

```typescript
function parseXUrl(url: string): { handle: string; tweetId: string } | null {
  const match = url.match(/x\.com\/([^/]+)\/status\/(\d+)/);
  if (!match) return null;
  return { handle: match[1], tweetId: match[2] };
}
```

### 2. Add imports

Add to the existing import block at the top of `tools.ts`:
```typescript
import { SelfReplyQueue } from "../db/index.js";
import { selfReplyService } from "../services/selfReplyService.js";
```

Note: `Post` is already imported via `import { Post, Reply, ... } from "../db/index.js"`.

### 3. Update `POST /db/replies` handler

Replace the current handler body:
```typescript
toolsRouter.post("/db/replies", async (req: Request, res: Response) => {
  try {
    const items = (Array.isArray(req.body) ? req.body : [req.body]).map((item) => ({
      ...item,
      status: "resolved",
    }));
    const replies = await Reply.insertMany(items, { ordered: false });
    res.json({ success: true, inserted: replies.length, replies });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});
```

With:
```typescript
toolsRouter.post("/db/replies", async (req: Request, res: Response) => {
  try {
    const items = (Array.isArray(req.body) ? req.body : [req.body]).map((item) => ({
      ...item,
      status: "resolved",
    }));
    const replies = await Reply.insertMany(items, { ordered: false });
    res.json({ success: true, inserted: replies.length, replies });

    // Trigger self-reply queue creation for resolved mentions on our own posts
    setImmediate(async () => {
      try {
        for (const reply of replies) {
          if (reply.status !== "resolved" || !reply.parent_post_url) continue;

          const parsed = parseXUrl(reply.url ?? "");
          if (!parsed) continue;

          const post = await Post.findOne({ post_url: reply.parent_post_url });
          if (!post) continue;

          const comment = {
            comment_id: parsed.tweetId,
            author_handle: reply.author_handle || parsed.handle,
            content: reply.reply_content,
            likes: 0,
          };

          const existing = await SelfReplyQueue.findOne({ our_post_id: post._id });
          if (existing) {
            await selfReplyService.addCommentToQueue(String(existing._id), comment);
          } else {
            await selfReplyService.createReplyQueue(String(post._id), reply.parent_post_url, [comment]);
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(`[tools/replies] Self-reply trigger error: ${msg}`);
      }
    });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});
```

Note: `log` is not currently imported in `tools.ts`. Add import:
```typescript
import { log } from "../utils/logger.js";
```

## Todo

- [ ] Add `log` import from `../utils/logger.js`
- [ ] Add `SelfReplyQueue` to the `../db/index.js` import
- [ ] Add `selfReplyService` import from `../services/selfReplyService.js`
- [ ] Add `parseXUrl()` helper function
- [ ] Update `POST /db/replies` handler with `setImmediate` block
- [ ] Run `npm run typecheck` — confirm no errors

## Success Criteria

- `tsc` passes
- Posting a reply with `parent_post_url` matching a seeded `Post` creates a `SelfReplyQueue` document
- Posting a reply without `parent_post_url` does not create a queue
- Posting a reply with `parent_post_url` for an unseeded post silently skips
- HTTP response is still returned before queue logic runs (non-blocking)

## Edge Cases

| Case | Handling |
|------|----------|
| `reply.url` is undefined/null | `parseXUrl("")` returns null → skip |
| `reply.author_handle` missing | Falls back to `parsed.handle` from URL |
| `Post.findOne` returns null | Skip — post not seeded |
| `insertMany` partial failure | `ordered: false` already handles; `replies` array contains only successful inserts |
| `selfReplyService.createReplyQueue` returns null (disabled/threshold) | Silently ignored — service logs internally |

## Risk Assessment

- Low risk — `setImmediate` block is fire-and-forget; errors are caught and logged
- No change to HTTP response contract
