# KOL Engagement System - Setup & Flow Guide

## 📚 Tổng quan

KOL Engagement System tự động hóa việc tương tác với 100-200 KOLs trên X/Twitter bao gồm:
- Crawl post mới
- AI phân tích nội dung và cá tính KOL
- Đề xuất reply phù hợp
- Gửi reply ở 2 chế độ: **AFK** (tự động) hoặc **Manual** (cần duyệt)

## 🚀 Cài đặt & Chạy

### 1. Cài đặt dependencies

```bash
npm install
```

### 2. Environment Variables

Thêm vào `.env`:

```bash
# Telegram Bot (cho Manual mode)
KOL_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_ADMIN_CHAT_ID=your_chat_id

# MongoDB (đã có từ trước)
MONGODB_URI=mongodb://localhost:27017/pipeline

# Redis (nếu dùng)
REDIS_URL=redis://localhost:6379
```

**Lấy Telegram Bot Token:**
1. Chat với [@BotFather](https://t.me/botfather)
2. Gửi `/newbot`
3. Copy token được cấp

**Lấy Chat ID:**
1. Chat với bot vừa tạo
2. Truy cập: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
3. Tìm `"chat":{"id":123456789` - đó là Chat ID

### 3. Khởi tạo Database

Chạy server để auto-create collections:

```bash
npm run dev
```

Hoặc dùng script init (nếu có):

```bash
npm run db:init
```

### 4. Chạy Cron Jobs

```bash
# Thêm cron jobs vào hệ thống
npm run cron:add:kol-crawl      # Mỗi 30 phút - Crawl posts
npm run cron:add:kol-analyze    # Mỗi 15 phút - Phân tích
npm run cron:add:kol-afk        # Mỗi 10 phút - Thực thi AFK replies
npm run cron:add:self-reply     # Mỗi 5 phút - Self-reply queue
```

**Chạy thủ công (testing):**

```bash
# Crawl ngay lập tức
npm run kol:crawl

# Analyze ngay lập tức  
npm run kol:analyze
```

---

## 🔄 Luồng hệ thống

### Luồng tổng quan

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  CRON JOB   │───▶│   CRAWLER   │───▶│   ANALYZER  │───▶│  REPLY      │
│ (30 phút)   │    │  (KOL Posts)│    │  (AI + NLP) │    │  ENGINE     │
└─────────────┘    └─────────────┘    └─────────────┘    └──────┬──────┘
                                                                │
                              ┌─────────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   MODE DECISION   │
                    └─────────┬─────────┘
              ┌───────────────┴───────────────┐
              ▼                                 ▼
       ┌─────────────┐                  ┌─────────────┐
       │  AFK MODE   │                  │ MANUAL MODE │
       │  (Tự động)  │                  │ (Cần duyệt) │
       └──────┬──────┘                  └──────┬──────┘
              │                                 │
              ▼                                 ▼
       ┌─────────────┐                  ┌─────────────┐
       │ Auto-send   │                  │ Telegram    │
       │ delay 5-15m │                  │ Notification│
       └─────────────┘                  └──────┬──────┘
                                                │
                                                ▼
                                         ┌─────────────┐
                                         │ Admin       │
                                         │ Approve/    │
                                         │ Reject      │
                                         └─────────────┘
```

---

## 🔧 Chi tiết từng luồng

### 1️⃣ Luồng Crawl (Mỗi 30 phút)

**File:** `src/services/kolCrawlerService.ts`

```
KolCrawlCron ──▶ crawlAllKols() ──▶ Query active KOLs ──▶ Queue OpenClaw tasks ──▶ Save to KolPost
```

**API liên quan:**
```bash
# Trigger manual crawl cho 1 KOL
POST /api/kols/:id/crawl

# Bulk import KOLs từ list
POST /api/kols/bulk-import
{"handles": ["elonmusk", "naval", "..."]}
```

**Dữ liệu lưu:**
- `KolPost`: Post content, engagement metrics, comments
- `KolProfile`: Cập nhật last_crawled_at

---

### 2️⃣ Luồng Analyze (Mỗi 15 phút)

**File:** `src/services/kolAnalyzerService.ts`

```
KolAnalyzeCron ──▶ analyzePendingPosts() ──▶ Queue AI tasks ──▶ Update KolPost analysis
```

**AI Analysis bao gồm:**
1. **Post Analysis**: Tóm tắt, sentiment, virality score
2. **Comment Pattern**: Phân tích top 10 comments, tìm pattern
3. **Personality Learning**: Học cá tính KOL (nếu đủ 20 posts)

**API liên quan:**
```bash
# Trigger analyze cho 1 post
POST /api/kol-posts/:id/analyze

# Trigger personality learning cho 1 KOL
POST /api/kols/:id/learn
```

**Dữ liệu lưu:**
- `KolPost.analysis`: summary, sentiment, virality_score, key_topics
- `KolPost.engagement_pattern`: dominant_tone, emoji_trend, common_phrases
- `KolProfile.personality_profile`: writing_style, slang_words, tone

---

### 3️⃣ Luồng Reply Generation & Routing

**File:** `src/services/replyEngineService.ts`

#### AFK Mode Flow

```
generateSuggestions() ──▶ AI creates 3 suggestions ──▶ processAFKMode()
                                                            │
                                                            ▼
                                              ┌─────────────────────────┐
                                              │ 1. Check confidence >= 70%│
                                              │ 2. Check virality > 30    │
                                              │ 3. Schedule delay 5-15m   │
                                              └─────────────────────────┘
                                                            │
                                                            ▼
                                              KolAFKReplyCron ──▶ executeReply()
```

**AFK Settings:**
```typescript
afk: {
  min_confidence_threshold: 70,  // Tối thiểu 70% mới auto-reply
  auto_delay_min_minutes: 5,   // Delay ngẫu nhiên 5-15 phút
  auto_delay_max_minutes: 15,
  hourly_reply_limit: 10,      // Tối đa 10 reply/giờ
  daily_reply_limit: 50        // Tối đa 50 reply/ngày
}
```

#### Manual Mode Flow

```
generateSuggestions() ──▶ AI creates 3 suggestions ──▶ sendTelegramNotification()
                                                            │
                                                            ▼
                                              Admin nhận message với buttons:
                                              [✅ Approve 1] [✅ Approve 2] [❌ Reject]
                                                            │
                                              ┌─────────────┴─────────────┐
                                              ▼                           ▼
                                    Admin click Approve              Admin click Reject
                                            │                            │
                                            ▼                            ▼
                                    executeReply()              rejectSuggestion()
                                            │                            │
                                            ▼                            ▼
                                    Gửi reply lên X             Đánh dấu rejected
```

**Manual Settings:**
```typescript
manual: {
  notification_channel: "",    // Telegram channel (nếu có)
  max_pending_hours: 24       // Tối đa chờ 24h
}
```

---

### 4️⃣ Luồng Self-Reply (Reply vào comments post của mình)

**File:** `src/services/selfReplyService.ts`

```
SelfReplyCron ──▶ processAllQueues() ──▶ Check rate limit ──▶ Rank comments
                                              │
                                              ▼
                                    ┌─────────────────────────┐
                                    │ Rank by:                │
                                    │ • Like count × 2        │
                                    │ • Trust score × 1.5     │
                                    │ • Question bonus +5     │
                                    │ • Mention bonus +3      │
                                    └─────────────────────────┘
                                              │
                                              ▼
                                    Check author reputation
                                    (Skip nếu trust_score < 30)
                                              │
                                              ▼
                                    Generate AI reply ──▶ Send via OpenClaw
```

**Self-Reply Settings:**
```typescript
self_reply: {
  enabled: true,
  min_comments_to_trigger: 5,    // Tối thiểu 5 comments mới trigger
  reply_interval_seconds: 120,   // 2 phút giữa các reply
  hourly_limit: 20               // Tối đa 20 reply/giờ
}
```

---

## 🎮 API Endpoints

### Settings API (Điều khiển chính)

```bash
# Xem mode hiện tại
GET /api/kol-settings/mode

# Chuyển sang AFK mode
POST /api/kol-settings/mode
{"mode": "afk"}

# Chuyển sang Manual mode  
POST /api/kol-settings/mode
{"mode": "manual"}

# Quick switch
POST /api/kol-settings/mode/afk
POST /api/kol-settings/mode/manual

# Xem toàn bộ settings
GET /api/kol-settings

# Update thresholds
PATCH /api/kol-settings/thresholds
{
  "min_confidence": 75,
  "delay_min": 3,
  "delay_max": 10,
  "hourly_limit": 15
}
```

### KOL Management API

```bash
# List KOLs
GET /api/kols?page=1&limit=20&status=active

# Thêm KOL mới
POST /api/kols
{
  "handle": "elonmusk",
  "platform": "x",
  "priority_score": 95,
  "notes": "AI/Tech influencer"
}

# Xem chi tiết 1 KOL
GET /api/kols/:id

# Trigger crawl
POST /api/kols/:id/crawl

# Trigger personality learning
POST /api/kols/:id/learn

# Bulk import
POST /api/kols/bulk-import
{"handles": ["naval", "sama", "..."]}
```

### Post & Reply API

```bash
# List posts
GET /api/kol-posts?status=analyzed&mode=afk&page=1

# Generate suggestions cho 1 post
POST /api/kol-posts/:id/suggest

# Manual reply (gửi ngay)
POST /api/kol-posts/:id/reply
{
  "content": "Your custom reply here"
}

# Xem pending manual reviews
GET /api/replies/pending

# Approve suggestion (Manual mode)
POST /api/replies/:id/approve
{
  "suggestion_index": 0,
  "edited_content": "Optional edited version"
}

# Reject suggestion
POST /api/replies/:id/reject
```

---

## 🛡️ Safety Features

### Rate Limiting
- Hourly limit: 10 replies/giờ (AFK), 20/giờ (Self-reply)
- Daily limit: 50 replies/ngày
- Delay giữa các reply: 1-3 phút (AFK), 2 phút (Self-reply)

### Reputation Check
- Trust score < 30: Skip hoàn toàn
- Trust score 30-70: Proceed với caution
- Trust score > 70: Proceed normally

### Post Quality Check
- Virality score > 30 mới AFK reply
- Detect spam/hidden content
- Duplicate detection (Levenshtein similarity > 80%)
- Banned words filter

---

## 📱 Telegram Bot Commands

Bot tự động gửi notification khi có suggestion cần duyệt (Manual mode).

**Commands:**
- `/start` hoặc `/menu` - Hiện main menu
- `/kols` - List các KOL đang follow
- `/pending` - Xem danh sách chờ duyệt
- `/stats` - Stats 24h

**Inline Buttons trong notification:**
- `✅ Approve 1/2/3` - Chọn suggestion để gửi
- `✏️ Edit` - Edit rồi gửi (sẽ implement sau)
- `❌ Reject` - Từ chối suggestion
- `🔗 View Post` - Xem post gốc

---

## 🔧 Webhook Setup (cho Telegram)

Thêm vào `src/app.ts` hoặc routes:

```typescript
import { handleCallbackQuery, handleCommand } from "./telegram/kolTelegramBotNative.js";

// Webhook endpoint
app.post("/webhook/kol-bot", async (req, res) => {
  const { callback_query, message } = req.body;
  
  if (callback_query) {
    await handleCallbackQuery(callback_query);
  }
  if (message?.text?.startsWith("/")) {
    await handleCommand(message);
  }
  
  res.sendStatus(200);
});
```

**Set webhook với Telegram:**
```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://yourdomain.com/webhook/kol-bot"
```

---

## 📝 Database Models

### Core Models

| Model | Mục đích | Key Fields |
|-------|----------|------------|
| `KolProfile` | Thông tin KOL | handle, reputation_score, personality_profile |
| `KolPost` | Posts đã crawl | content, engagement_metrics, analysis, status |
| `KolReplySuggestion` | AI suggestions | suggestions[], mode, execution_status |
| `KolReputationCache` | Cache reputation | trust_score, updated_at (TTL 24h) |
| `SelfReplyQueue` | Queue self-replies | pending_comments, priority_score |
| `KolSettings` | Global config | default_mode, afk, manual, safety |

### Relationships
```
KolProfile 1 ────── N KolPost 1 ────── N KolReplySuggestion
                        │
                        └── 1 SelfReplyQueue (per user post)
```

---

## 🐛 Troubleshooting

### Lỗi thường gặp

**1. Cron jobs không chạy**
```bash
# Kiểm tra jobs đã được add chưa
npm run cron:list

# Chạy thủ công để test
tsx src/scripts/kolCrawlCron.ts
```

**2. Telegram không nhận notification**
- Kiểm tra `KOL_BOT_TOKEN` và `TELEGRAM_ADMIN_CHAT_ID`
- Chat với bot trước (bot không thể gửi message cho user chưa từng chat)
- Kiểm tra webhook URL có đúng không

**3. AI không generate suggestions**
- Kiểm tra post đã được analyze chưa (status = "analyzed")
- Kiểm tra OpenClaw task queue có bị stuck không
- Xem log: `grep "ReplyEngine" logs/app.log`

**4. Rate limit quá nghiêm ngặt**
```bash
# Update thresholds
PATCH /api/kol-settings/thresholds
{
  "hourly_limit": 20,
  "delay_min": 2,
  "delay_max": 5
}
```

---

## 📊 Monitoring

**Stats endpoint:**
```bash
GET /api/kol-posts/stats
```

**Logs:**
```bash
# Xem real-time logs
tail -f logs/app.log | grep "KOL"

# Filter theo service
tail -f logs/app.log | grep "ReplyEngine"
tail -f logs/app.log | grep "KolCrawler"
```

---

## 🔄 CI/CD

**Git workflow:**
```bash
# Branch hiện tại: feat/kol
git add .
git commit -m "feat: add KOL engagement system"
git push origin feat/kol

# Merge vào main
gh pr create --title "feat: KOL engagement system" --body "..."
```

---

## 🎯 Tóm tắt nhanh

| Bạn muốn | Làm gì |
|----------|--------|
| **Xem mode hiện tại** | `GET /api/kol-settings/mode` |
| **Chuyển sang AFK** | `POST /api/kol-settings/mode` `{"mode":"afk"}` |
| **Chuyển sang Manual** | `POST /api/kol-settings/mode` `{"mode":"manual"}` |
| **Thêm KOL mới** | `POST /api/kols` `{"handle":"..."}` |
| **Crawl ngay** | `POST /api/kols/:id/crawl` |
| **Xem pending** | `GET /api/replies/pending` |
| **Approve reply** | `POST /api/replies/:id/approve` |

---

## 📞 Support

**Team:** Cinee Pipeline  
**Docs:** [KOL-ENGAGEMENT-PLAN.md](./KOL-ENGAGEMENT-PLAN.md)  
**API Base:** `http://localhost:3000/api`
