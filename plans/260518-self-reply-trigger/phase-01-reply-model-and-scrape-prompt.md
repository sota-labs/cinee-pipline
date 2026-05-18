# Phase 1: Reply Model + SCRAPE_PROMPT

**Status:** Pending
**Priority:** High — foundation for all other phases

## Context Links

- Spec: `plans/reports/spec-260518-self-reply-trigger.md` §1, §2
- Reply model: `src/db/models/Reply.ts`
- Scheduler prompts: `src/services/schedulerPrompts.ts`

## Overview

Add two new optional fields to the `Reply` model so the SCRAPE_PROMPT can carry `author_handle` and `parent_post_url` through to the route trigger. Update SCRAPE_PROMPT Step 3 and Step 4 to extract and include these fields in the POST payload.

## File Ownership

- `src/db/models/Reply.ts`
- `src/services/schedulerPrompts.ts`

## Requirements

### Functional
- `IReply` interface gains `author_handle?: string` and `parent_post_url?: string`
- Mongoose schema gains matching optional fields with sparse index on `author_handle`
- SCRAPE_PROMPT Step 3 instructs agent to extract `parent_post_url` from the notification item
- SCRAPE_PROMPT Step 4 JSON payload includes both new fields

### Non-functional
- Both fields are optional — existing replies without them are unaffected
- No migration needed (MongoDB schema-less, sparse index handles nulls)

## Implementation Steps

### 1. `src/db/models/Reply.ts`

Add to `IReply` interface (after `url?: string`):
```typescript
author_handle?: string;
parent_post_url?: string;
```

Add to `replySchema` (after `url: String`):
```typescript
author_handle: { type: String, sparse: true },
parent_post_url: { type: String },
```

Add index after existing indexes:
```typescript
replySchema.index({ author_handle: 1 }, { sparse: true });
replySchema.index({ parent_post_url: 1 }, { sparse: true });
```

### 2. `src/services/schedulerPrompts.ts`

**Step 3** — add to the extraction list:
```
- 'parent_post_url': The URL of YOUR OWN post that this mention is replying to.
  Look for a quoted tweet link or the "in reply to" context in the notification.
  This will be a URL matching https://x.com/{X_USERNAME}/status/... where {X_USERNAME} is your own account.
  If not found, omit this field.
```

**Step 4** — add two fields to the JSON object template:
```
- author_handle: (the @username extracted in Step 3, without the @ prefix)
- parent_post_url: (the URL of your own post being replied to, if found)
```

The full Step 4 payload becomes:
```json
{
  "reply_content": "...",
  "tone_used": "supportive",
  "status": "resolved|rejected",
  "platform": "x",
  "url": "https://x.com/commenter/status/123",
  "author_handle": "commenter",
  "parent_post_url": "https://x.com/ownaccount/status/456",
  "created_at": "...",
  "updated_at": "..."
}
```

Note: `parent_post_url` is omitted when not found — the route handler checks for its presence before triggering.

## Todo

- [ ] Add `author_handle` and `parent_post_url` to `IReply` interface
- [ ] Add fields to `replySchema`
- [ ] Add sparse indexes for both new fields
- [ ] Update SCRAPE_PROMPT Step 3 to extract `parent_post_url`
- [ ] Update SCRAPE_PROMPT Step 4 payload to include both new fields
- [ ] Run `npm run typecheck` — confirm no errors

## Success Criteria

- `tsc` passes with no new errors
- `Reply.create({ reply_content: "x", tone_used: "supportive", platform: "x", author_handle: "alice", parent_post_url: "https://x.com/me/status/1" })` does not throw a validation error
- Existing replies without the new fields are unaffected

## Risk Assessment

- Low risk — additive schema change, both fields optional
- Sparse index on `author_handle` avoids duplicate-key errors for null values (existing `thread_id` uses same pattern)

## Next Steps

Phase 2 (`src/routes/tools.ts`) reads `reply.author_handle` and `reply.parent_post_url` — must complete Phase 1 first.
