# KOL Engagement System - Setup & Testing Guide

## Tổng quan

KOL Engagement System tự động hóa việc tương tác với KOLs trên X/Twitter:
- Crawl post mới mỗi 30 phút
- AI phân tích nội dung, cá tính, và slang của KOL
- Đề xuất reply phù hợp với giọng văn của KOL
- Gửi reply ở 2 chế độ: **AFK** (tự động) hoặc **Manual** (xác nhận qua Telegram)

---

## 1. Cài đặt

### 1.1 Dependencies

```bash
npm install
```

### 1.2 Environment Variables

Copy file mẫu và điền thông tin:

```bash
cp .env.example .env
```

Các biến bắt buộc:

```bash
# Database
MONGO_URI=mongodb://localhost:27017/cinee_pipeline
REDIS_URL=redis://localhost:6379/0

# Server
PORT=3000
NODE_ENV=development
PUBLIC_API_URL=http://localhost:3000

# X/Twitter account (không có @)
X_USERNAME=your_x_handle

# OpenClaw agent name
OPENCLAW_AGENT=main

# Telegram Bot (bắt buộc cho Manual mode)
KOL_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_ADMIN_CHAT_ID=your_chat_id
```

---

## 2. Lấy Telegram Bot Token và Chat ID

### 2.1 Tạo Telegram Bot

1. Mở Telegram, tìm kiếm **@BotFather**
2. Gửi lệnh `/newbot`
3. Đặt tên bot (ví dụ: `KOL Manager`)
4. Đặt username bot (phải kết thúc bằng `bot`, ví dụ: `my_kol_manager_bot`)
5. BotFather sẽ trả về token dạng:
   ```
   1234567890:ABCdefGHIjklMNOpqrSTUvwxYZ
   ```
6. Copy token này vào `KOL_BOT_TOKEN` trong `.env`

### 2.2 Lấy Chat ID của bạn

**Cách 1 — Dùng @userinfobot (dễ nhất):**
1. Tìm kiếm **@userinfobot** trên Telegram
2. Gửi `/start`
3. Bot sẽ trả về thông tin bao gồm `Id: 123456789`
4. Copy số đó vào `TELEGRAM_ADMIN_CHAT_ID`

**Cách 2 — Dùng API trực tiếp:**
1. Chat với bot vừa tạo (gửi bất kỳ tin nhắn nào)
2. Mở trình duyệt, truy cập:
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```
   Ví dụ:
   ```
   https://api.telegram.org/bot1234567890:ABCdef/getUpdates
   ```
3. Tìm trong JSON trả về:
   ```json
   "chat": {
     "id": 123456789,
     "first_name": "Your Name",
     "type": "private"
   }
   ```
4. Số `id` đó là Chat ID của bạn

> **Lưu ý:** Bot không thể gửi tin nhắn cho bạn nếu bạn chưa từng chat với nó. Hãy gửi `/start` cho bot trước.

### 2.3 Đăng ký Webhook

Sau khi server đang chạy, đăng ký webhook để Telegram gửi updates về server:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -d "url=https://yourdomain.com/webhook/kol-bot"
```

Kiểm tra webhook đã được set chưa:

```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo"
```

> **Khi test local:** Dùng [ngrok](https://ngrok.com) để expose localhost:
> ```bash
> ngrok http 3000
> # Copy URL dạng https://xxxx.ngrok.io rồi dùng làm webhook URL
> ```

---

## 3. Khởi động

```bash
# Development
npm run dev

# Production
npm run build && npm start
```

Kiểm tra server đang chạy:
```bash
curl http://localhost:3000/
```

---

## 4. Thêm KOL vào hệ thống

### 4.1 Thêm 1 KOL

```bash
curl -X POST http://localhost:3000/api/kols \
  -H "Content-Type: application/json" \
  -d '{"handle": "elonmusk"}'
```

### 4.2 Bulk import nhiều KOL

```bash
curl -X POST http://localhost:3000/api/kols/bulk-import \
  -H "Content-Type: application/json" \
  -d '{"handles": ["naval", "sama", "levelsio"]}'
```

### 4.3 Xem danh sách KOL

```bash
curl http://localhost:3000/api/kols
```

---

## 5. Chạy Daemon (tất cả cron jobs)

```bash
# Chạy daemon (crawl + analyze + reply + self-reply)
npm run kol:daemon

# Chạy daemon và fire ngay lập tức lần đầu
npm run kol:daemon -- --run-now
```

Daemon tự động chạy các jobs:

| Job | Interval | Mô tả |
|-----|----------|-------|
| Crawl posts | 30 phút | Lấy post mới từ KOLs |
| Analyze posts | 10 phút | AI phân tích nội dung |
| AFK replies | 10 phút | Thực thi reply đã schedule |
| Auto-reject | 10 phút | Reject manual suggestions quá 1 giờ |
| Self-reply | 2 phút | Reply vào comments post của mình |
| Personality learning | 02:00 AM | Học cá tính KOL hàng ngày |

---

## 6. Chế độ hoạt động

### 6.1 Xem mode hiện tại

```bash
curl http://localhost:3000/api/kol-settings/mode
```

### 6.2 Chuyển sang AFK mode

```bash
curl -X POST http://localhost:3000/api/kol-settings/mode/afk
```

Trong AFK mode:
- Hệ thống tự chọn suggestion có confidence cao nhất (≥ 70%)
- Kiểm tra virality score của post (> 30)
- Schedule reply với delay ngẫu nhiên 5–15 phút
- Không cần xác nhận từ người dùng

### 6.3 Chuyển sang Manual mode

```bash
curl -X POST http://localhost:3000/api/kol-settings/mode/manual
```

Trong Manual mode (đã cải tiến):
- Hệ thống vẫn tự chọn suggestion tốt nhất (dùng logic AFK)
- Gửi tin nhắn Telegram với suggestion đã chọn sẵn
- Bạn chỉ cần bấm **✅ Confirm** hoặc **❌ Reject**
- Nếu muốn xem tất cả options → bấm **🔄 See All**
- **Tự động reject sau 1 giờ** nếu không có phản hồi

---

## 7. Test Manual Mode (Confirm Flow)

### Bước 1: Đảm bảo Telegram đã cấu hình

```bash
# Kiểm tra settings
curl http://localhost:3000/api/kol-settings
```

Xác nhận `manual.auto_reject_after_minutes` = 60.

### Bước 2: Chuyển sang Manual mode

```bash
curl -X POST http://localhost:3000/api/kol-settings/mode/manual
```

### Bước 3: Trigger crawl và analyze

```bash
# Crawl posts từ KOL
curl -X POST http://localhost:3000/api/kols/<KOL_ID>/crawl

# Hoặc chạy daemon với --run-now
npm run kol:daemon -- --run-now
```

### Bước 4: Xem pending suggestions

```bash
curl http://localhost:3000/api/replies/pending
```

### Bước 5: Kiểm tra Telegram

Khi có suggestion mới, bot sẽ gửi tin nhắn dạng:

```
🤖 Reply to @kol_handle

📝 Post: "Nội dung post của KOL..."

💬 Reply: "Nội dung reply AI đề xuất"
📊 Confidence: 85% | Tone: casual

⏱ Auto-reject in 1 hour if no response

[✅ Confirm]  [❌ Reject]
[🔄 See All Options]
```

- **✅ Confirm** → Reply được gửi ngay lên X
- **❌ Reject** → Suggestion bị reject
- **🔄 See All Options** → Hiện đầy đủ 3 suggestions để chọn

### Bước 6: Test auto-reject

Để test auto-reject nhanh (không cần chờ 1 giờ), tạm thời giảm timeout:

```bash
curl -X PATCH http://localhost:3000/api/kol-settings \
  -H "Content-Type: application/json" \
  -d '{"manual": {"auto_reject_after_minutes": 1}}'
```

Sau 1 phút, chạy cron thủ công:

```bash
npx tsx src/scripts/kolAutoRejectCron.ts
```

Kiểm tra suggestion đã bị reject:

```bash
curl http://localhost:3000/api/replies/pending
# Kết quả phải là mảng rỗng
```

Nhớ đặt lại timeout về 60:

```bash
curl -X PATCH http://localhost:3000/api/kol-settings \
  -H "Content-Type: application/json" \
  -d '{"manual": {"auto_reject_after_minutes": 60}}'
```

---

## 8. Test AFK Mode

### Bước 1: Chuyển sang AFK mode

```bash
curl -X POST http://localhost:3000/api/kol-settings/mode/afk
```

### Bước 2: Giảm delay để test nhanh

```bash
curl -X PATCH http://localhost:3000/api/kol-settings/thresholds \
  -H "Content-Type: application/json" \
  -d '{"delay_min": 1, "delay_max": 1}'
```

### Bước 3: Trigger suggestion generation

```bash
curl -X POST http://localhost:3000/api/kol-posts/<POST_ID>/suggest
```

### Bước 4: Chạy AFK cron thủ công

```bash
npx tsx src/scripts/kolAFKReplyCron.ts
```

### Bước 5: Kiểm tra kết quả

```bash
# Xem post đã được reply chưa
curl http://localhost:3000/api/kol-posts/<POST_ID>
# status phải là "replied"
```

---

## 9. Test KOL Slang Learning

### Bước 1: Trigger personality learning cho 1 KOL

```bash
curl -X POST http://localhost:3000/api/kols/<KOL_ID>/learn
```

### Bước 2: Kiểm tra profile đã có slang_examples chưa

```bash
curl http://localhost:3000/api/kols/<KOL_ID>
```

Tìm trong response:

```json
"personality_profile": {
  "slang_words": ["ngmi", "wagmi", "ser"],
  "slang_examples": [
    { "word": "ngmi", "context": "mocking bad decisions: 'still holding that bag... ngmi'" },
    { "word": "ser", "context": "addressing someone: 'ser, this is the alpha'" }
  ]
}
```

> **Lưu ý:** Cần ít nhất 5 posts đã analyzed mới trigger được personality learning.

---

## 10. Telegram Bot Commands

Gửi trực tiếp cho bot:

| Command | Mô tả |
|---------|-------|
| `/start` hoặc `/menu` | Hiện main menu |
| `/pending` | Xem danh sách suggestions chờ duyệt |
| `/kols` | Danh sách KOL đang theo dõi |
| `/stats` | Thống kê 24 giờ qua |

---

## 11. API Reference nhanh

### Settings

```bash
GET    /api/kol-settings              # Xem toàn bộ settings
GET    /api/kol-settings/mode         # Xem mode hiện tại
POST   /api/kol-settings/mode/afk     # Chuyển AFK
POST   /api/kol-settings/mode/manual  # Chuyển Manual
PATCH  /api/kol-settings              # Update settings
PATCH  /api/kol-settings/thresholds   # Update AFK thresholds
```

### KOL Management

```bash
GET    /api/kols                      # Danh sách KOL
POST   /api/kols                      # Thêm KOL mới {"handle": "..."}
GET    /api/kols/:id                  # Chi tiết 1 KOL
POST   /api/kols/bulk-import          # Import nhiều KOL {"handles": [...]}
POST   /api/kols/:id/crawl            # Trigger crawl ngay
POST   /api/kols/:id/learn            # Trigger personality learning
```

### Posts & Replies

```bash
GET    /api/kol-posts                 # Danh sách posts
POST   /api/kol-posts/:id/suggest     # Generate suggestions cho post
GET    /api/replies/pending           # Danh sách chờ duyệt (Manual mode)
POST   /api/replies/:id/approve       # Approve suggestion
POST   /api/replies/:id/reject        # Reject suggestion
```

---

## 12. Luồng hệ thống

```
KOL Posts (X/Twitter)
        │
        ▼ (mỗi 30 phút)
   [CRAWLER] ──▶ KolPost (status: NEW)
        │
        ▼ (mỗi 10 phút)
   [ANALYZER] ──▶ KolPost (status: ANALYZED)
        │         └── Học slang + cá tính KOL
        ▼
[REPLY ENGINE] ──▶ KolReplySuggestion
        │
        ├── AFK mode ──▶ Auto-select best ──▶ Schedule 5-15m ──▶ Execute
        │
        └── Manual mode ──▶ Auto-select best ──▶ Telegram Confirm
                                                      │
                                          ┌───────────┼───────────┐
                                          ▼           ▼           ▼
                                      Confirm      Reject     See All
                                          │                       │
                                       Execute              Show full list
                                                            (pick manually)
                                    (nếu không phản hồi sau 1h → auto-reject)
```

---

## 13. Troubleshooting

**Bot không gửi tin nhắn:**
- Đảm bảo đã chat với bot ít nhất 1 lần (`/start`)
- Kiểm tra `KOL_BOT_TOKEN` và `TELEGRAM_ADMIN_CHAT_ID` đúng chưa
- Thử gọi API trực tiếp để test:
  ```bash
  curl "https://api.telegram.org/bot<TOKEN>/sendMessage" \
    -d "chat_id=<CHAT_ID>&text=test"
  ```

**Suggestions không được generate:**
- Kiểm tra post đã có status `analyzed` chưa
- KOL cần có `personality_profile.writing_style` (chạy `/learn` trước)
- Xem log: `grep "ReplyEngine" logs/app.log`

**Auto-reject không chạy:**
- Kiểm tra daemon đang chạy: `npm run kol:daemon`
- Chạy thủ công: `npx tsx src/scripts/kolAutoRejectCron.ts`

**Confidence quá thấp, không có suggestion nào được chọn:**
- Giảm threshold: `PATCH /api/kol-settings/thresholds` với `{"min_confidence": 50}`
- Khi không có suggestion đủ điều kiện, Manual mode sẽ hiện full list thay vì confirm flow
