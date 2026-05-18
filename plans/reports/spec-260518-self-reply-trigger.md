# Spec: Self-Reply Trigger via Notification Webhook

## Problem Statement

`createReplyQueue()` tồn tại nhưng không bao giờ được gọi — luồng self-reply bị đứt ở đầu vào. Không có cơ chế nào phát hiện khi bài post của mình có comment mới.

**User story:** Khi ai đó comment vào bài post của mình trên X, hệ thống tự động tạo queue để AI generate và gửi reply — không cần can thiệp thủ công.

---

## Approach

Tận dụng `SCRAPE_PROMPT` đang chạy mỗi giờ tại `:20`. Thêm 2 fields vào payload gửi lên `POST /api/tools/db/replies`, sau đó route handler trigger `createReplyQueue()` / `addCommentToQueue()` inline ngay khi lưu reply.

**Không cần cron job mới. Không cần thay đổi Task queue.**

---

## Changes Required

### 1. Reply model — thêm 2 fields

File: `src/db/models/Reply.ts`

```
author_handle: String  (optional, sparse)
parent_post_url: String  (optional)
```

`author_handle` — @username của người comment, parse từ URL nếu không có.
`parent_post_url` — URL bài post gốc của mình mà người đó reply vào.

### 2. SCRAPE_PROMPT — thêm 2 fields vào Step 3 + Step 4

File: `src/services/schedulerPrompts.ts`

Step 3 bổ sung:
- `author_handle`: @username từ tweet header (đã có trong prompt, chỉ cần đưa vào payload)
- `parent_post_url`: URL bài post gốc — tìm trong notification item, thường là link tweet của mình mà người đó reply vào (dạng `https://x.com/{X_USERNAME}/status/...`)

Step 4 payload bổ sung:
```json
{
  "reply_content": "...",
  "tone_used": "supportive",
  "status": "resolved",
  "platform": "x",
  "url": "https://x.com/commenter/status/123",
  "author_handle": "commenter",
  "parent_post_url": "https://x.com/ownaccount/status/456",
  "created_at": "...",
  "updated_at": "..."
}
```

### 3. `POST /api/tools/db/replies` — trigger self-reply inline

File: `src/routes/tools.ts`

Sau khi `Reply.insertMany()` thành công, với mỗi reply có `status === "resolved"` và `parent_post_url`:

```
setImmediate(async () => {
  for (const reply of savedReplies) {
    if (reply.status !== "resolved" || !reply.parent_post_url) continue;

    // Parse comment_id và author_handle từ URL
    // url format: https://x.com/{handle}/status/{id}
    const parsed = parseXUrl(reply.url);
    if (!parsed) continue;

    // Lookup bài post gốc
    const post = await Post.findOne({ post_url: reply.parent_post_url });
    if (!post) continue;

    // Tạo comment object
    const comment = {
      comment_id: parsed.tweetId,
      author_handle: reply.author_handle || parsed.handle,
      content: reply.reply_content,
      likes: 0,
    };

    // Tạo queue hoặc thêm vào queue hiện có
    const existing = await SelfReplyQueue.findOne({ our_post_id: post._id });
    if (existing) {
      await selfReplyService.addCommentToQueue(String(existing._id), comment);
    } else {
      await selfReplyService.createReplyQueue(String(post._id), reply.parent_post_url, [comment]);
    }
  }
});
```

### 4. `selfReplyService.addCommentToQueue()` — method mới

File: `src/services/selfReplyService.ts`

Thêm comment vào queue hiện có nếu `comment_id` chưa tồn tại:

```typescript
async addCommentToQueue(
  queueId: string,
  comment: { comment_id: string; author_handle: string; content: string; likes: number }
): Promise<boolean>
```

Logic:
1. Tìm queue theo `queueId`
2. Check duplicate: nếu `pending_comments` đã có `comment_id` này → return false
3. Append comment mới với `status: PENDING`, `priority_score: 0`
4. Chạy `rankComments()` để tính lại priority
5. Save và return true

### 5. Helper `parseXUrl()`

File: `src/routes/tools.ts` (hoặc `src/utils/`)

```typescript
function parseXUrl(url: string): { handle: string; tweetId: string } | null {
  const match = url.match(/x\.com\/([^/]+)\/status\/(\d+)/);
  if (!match) return null;
  return { handle: match[1], tweetId: match[2] };
}
```

---

## Data Flow

```
x.com/notifications/mentions
        ↓ (SCRAPE_PROMPT Phase A)
POST /api/tools/db/replies
  [{ url, reply_content, author_handle, parent_post_url, status: "resolved" }]
        ↓ (inline setImmediate)
parseXUrl(reply.url) → { handle, tweetId }
Post.findOne({ post_url: parent_post_url }) → post
        ↓
SelfReplyQueue.findOne({ our_post_id: post._id })
  ├── null → createReplyQueue(post._id, parent_post_url, [comment])
  └── exists → addCommentToQueue(queueId, comment)
        ↓
rankComments() → priority_score per comment
        ↓
kolDaemon (processAllQueues, mỗi 5 phút)
  → getNextReplyCandidate() → queueSelfReplyGeneration()
  → OpenClaw AI generate reply
  → processSelfReplyResult()
      ├── AFK → sendReply() (execute via OpenClaw)
      └── Manual → storeForManualReview() + Telegram notification
```

---

## Edge Cases

| Case | Handling |
|------|----------|
| `parent_post_url` không có trong payload | Skip — không trigger self-reply |
| `Post.findOne()` không tìm thấy | Skip — bài post chưa được seed vào DB |
| `url` không parse được | Skip — dùng `author_handle` từ field nếu có, nếu không skip |
| Duplicate `comment_id` | `addCommentToQueue()` check và return false |
| Reply có `status: "rejected"` | Skip — không tạo queue cho spam/bot |
| `self_reply.enabled = false` | `createReplyQueue()` đã check và return null |

---

## Files Changed

| File | Type | Change |
|------|------|--------|
| `src/db/models/Reply.ts` | Modify | Thêm `author_handle`, `parent_post_url` fields |
| `src/services/schedulerPrompts.ts` | Modify | Thêm `author_handle`, `parent_post_url` vào SCRAPE_PROMPT |
| `src/routes/tools.ts` | Modify | Trigger self-reply inline sau insertMany |
| `src/services/selfReplyService.ts` | Modify | Thêm `addCommentToQueue()` method |

Tổng: 4 files, không có file mới.

---

## Mode Handling (AFK vs Manual)

`processSelfReplyResult()` đã check `KolSettings.default_mode` — đúng hướng. Cần hoàn thiện cả 2 nhánh:

### AFK mode — `sendReply()` phải thực sự gọi OpenClaw

`sendReply()` hiện là stub (mark SENT giả). Cần thay bằng Task queue giống pattern KOL reply:

```
sendReply(queueId, commentId, replyContent)
  → Task.create({ type: SINGLE_TASK_TRIGGER, payload: { action: "execute_self_reply", queueId, commentId } })
  → comment.status = ECommentStatus.QUEUED (đã executing, không pick lại)
  → webhook PATCH /api/tasks/:id/complete → mark comment SENT + update last_reply_sent_at
  → webhook PATCH /api/tasks/:id/fail → mark comment FAILED
```

### Manual mode — `storeForManualReview()` phải gửi Telegram

Hiện chỉ lưu `reply_content` vào DB, không notify. Cần thêm:

```
storeForManualReview(queueId, commentId, replyContent)
  → lưu reply_content (đã có)
  → gọi sendSelfReplyConfirmation(queueId, commentId) từ kolTelegramBotNative
```

**`sendSelfReplyConfirmation()`** — function mới trong `kolTelegramBotNative.ts`:

Message format:
```
💬 Reply to comment on your post

📝 Post: <post content 100 chars>
👤 @commenter: "<comment content>"

🤖 Reply: "<AI generated reply>"

[✅ Confirm] [✏️ Edit] [❌ Reject]
```

Callback data:
- `self_confirm:<queueId>:<commentId>` → execute via OpenClaw
- `self_edit:<queueId>:<commentId>` → pendingEditState flow (same pattern as KOL edit)
- `self_reject:<queueId>:<commentId>` → mark comment SKIPPED

**Approve handler** gọi `sendReply(queueId, commentId, replyContent)` — dùng lại AFK execution path.

### Files bổ sung

| File | Change |
|------|--------|
| `src/services/selfReplyService.ts` | `sendReply()` tạo Task thay vì stub; `storeForManualReview()` gọi Telegram |
| `src/telegram/kolTelegramBotNative.ts` | Thêm `sendSelfReplyConfirmation()`, handlers `self_confirm/edit/reject` |
| `src/routes/tasks.ts` | Thêm handler `execute_self_reply` trong complete/fail webhook |

---

---

## /seed — Manual Post Seeding via Telegram

User đăng bài thủ công lên X, sau đó dùng `/seed` trong Telegram để seed bài vào `Post` collection — không cần gọi API thô.

### UX Flow (multi-step conversation)

```
/seed
  → Bot: inline keyboard chọn content_type (5 buttons)

User click content_type
  → Bot: "Nhập nội dung bài post:"

User gửi raw_content
  → Bot: "Nhập URL bài post (x.com/...):"

User gửi post_url
  → Bot: confirmation message + [✅ Confirm] [❌ Cancel]

User click Confirm
  → Post.create({ content_type, raw_content, post_url, status: POSTED, platform: "twitter", ... defaults })
  → Bot: "✅ Bài post đã được lưu."
```

### State Machine

Dùng in-memory Map (pattern giống `pendingEditState`):

```typescript
type ESeedStep = "awaiting_content_type" | "awaiting_raw_content" | "awaiting_post_url" | "awaiting_confirm"

interface ISeedState {
  step: ESeedStep;
  content_type?: string;
  raw_content?: string;
  post_url?: string;
}

const pendingSeedState = new Map<string, ISeedState>();
// chatId → ISeedState, timeout 10 phút
```

### Callback data

- `seed_type:<content_type>` — user chọn loại bài
- `seed_confirm` — user xác nhận lưu
- `seed_cancel` — user huỷ

### Text message routing

`handleTextMessage()` cần check `pendingSeedState` song song với `pendingEditState`:

```
pendingEditState.has(chatId) → xử lý edit flow
pendingSeedState.has(chatId) → xử lý seed flow (raw_content hoặc post_url tùy step)
```

### Files thay đổi

| File | Change |
|------|--------|
| `src/telegram/kolTelegramBotNative.ts` | Thêm `pendingSeedState`, `handleSeedCommand()`, `handleSeedCallback()`, cập nhật `handleTextMessage()` và `handleCommand()` |
| `src/routes/tools.ts` | Không thay đổi — dùng `Post.create()` trực tiếp trong bot handler |

### Validation

- `post_url` phải match pattern `x.com/.+/status/\d+` — nếu sai bot nhắc nhập lại
- `raw_content` không được rỗng
- Duplicate `post_url` → báo lỗi "Bài post này đã tồn tại trong DB"

---

## Out of Scope

- Manual approve/reject API route (dùng Telegram thay thế)
- Auto-seed khi bài được mark POSTED (có thể thêm sau)

---

## Success Criteria

1. Sau khi `scrape_x_notifications` chạy, `SelfReplyQueue` được tạo tự động cho bài post có mentions
2. Comment mới đến giờ sau được append vào queue hiện có, không tạo duplicate
3. `kolDaemon.processAllQueues()` pick up queue và queue AI generation task
4. Rejected mentions (spam/bot) không tạo queue
