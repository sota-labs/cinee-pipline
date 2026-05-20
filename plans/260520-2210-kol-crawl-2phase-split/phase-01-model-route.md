---
phase: 1
priority: high
effort: small
---

# Phase 1: Model + Route Changes

## Files

- `src/db/models/Task.ts`
- `src/db/models/KolPost.ts`
- `src/routes/kolPosts.ts`

---

## 1. Task.ts — Add KOL_COMMENT_CRAWL type

**File**: `src/db/models/Task.ts`

Add to `ETaskType` enum:

```typescript
KOL_COMMENT_CRAWL = "kol_comment_crawl",
```

---

## 2. KolPost.ts — Add comments_crawled field

**File**: `src/db/models/KolPost.ts`

Add to `IKolPost` interface and schema:

```typescript
// Interface
comments_crawled: boolean;

// Schema
comments_crawled: { type: Boolean, default: false },
```

Add index for reply engine query:
```typescript
{ status: 1, comments_crawled: 1, crawled_at: -1 }
```

---

## 3. kolPosts.ts — Add PATCH /:id/comments route

**File**: `src/routes/kolPosts.ts`

Add after existing routes:

```typescript
// PATCH /api/kol-posts/:id/comments
router.patch("/:id/comments", async (req, res) => {
  try {
    const { top_comments } = req.body;
    if (!Array.isArray(top_comments)) {
      return res.status(400).json({ error: "top_comments must be an array" });
    }
    const post = await KolPost.findByIdAndUpdate(
      req.params.id,
      { top_comments, comments_crawled: true },
      { new: true }
    );
    if (!post) return res.status(404).json({ error: "Post not found" });
    res.json({ success: true, post });
  } catch (err: unknown) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

---

## Todo

- [ ] Add `KOL_COMMENT_CRAWL` to `ETaskType` in `Task.ts`
- [ ] Add `comments_crawled: boolean` field to `KolPost.ts` interface + schema
- [ ] Add compound index `{ status, comments_crawled, crawled_at }` to `KolPost.ts`
- [ ] Add `PATCH /:id/comments` route to `kolPosts.ts`
- [ ] Run `npx tsc --noEmit` to verify no type errors
