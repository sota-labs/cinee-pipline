# Setup Guide

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 22+ | |
| MongoDB | 6+ | Local or remote URI |
| Redis | 7+ | Local or remote URI |
| OpenClaw CLI | latest | Must be accessible as `openclaw` in PATH |
| Telegram Bot | — | Create via [@BotFather](https://t.me/BotFather) |
| OpenAI API Key | — | Requires GPT-4o access |

---

## 1. Install dependencies

```bash
npm install
```

Generate the Prisma client (required before first run):

```bash
npx prisma generate
```

---

## 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in all values:

```env
# ── Data Stores ──
MONGO_URI=mongodb://localhost:27017/cinee_pipeline
REDIS_URL=redis://localhost:6379/0

# ── Server ──
PORT=3000
NODE_ENV=development
PUBLIC_API_URL=http://localhost:3000   # Must be reachable by OpenClaw agents

# ── OpenClaw ──
OPENCLAW_AGENT=main                   # The OpenClaw agent name to use
X_USERNAME=your_x_handle              # Without @

# ── AI ──
OPENAI_API_KEY=sk-...                 # Required: GPT-4o + text-embedding-3-small

# ── Telegram ──
TELEGRAM_BOT_TOKEN=123456:ABC...      # From @BotFather
TELEGRAM_ADMIN_CHAT_ID=987654321      # Your personal Telegram chat ID

# ── Role (optional) ──
FOUNDER_NAME=YourName
```

### How to get your Telegram chat ID
1. Start a chat with your bot
2. Visit: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
3. Look for `"chat":{"id": <YOUR_CHAT_ID>}`

---

## 3. Run

```bash
# Development (hot reload)
npm run start:dev

# Production build
npm run build
npm run start:prod
```

Server starts on `http://localhost:3000` (or `PORT` from `.env`).

---

## 4. Add KOLs to monitor

Once the server is running, add KOLs via the API:

```bash
# Add a KOL
curl -X POST http://localhost:3000/api/kols \
  -H "Content-Type: application/json" \
  -d '{
    "handle": "elonmusk",
    "platform": "x",
    "displayName": "Elon Musk",
    "profileUrl": "https://x.com/elonmusk",
    "isActive": true
  }'

# List all KOLs
curl http://localhost:3000/api/kols

# Manually trigger style learning for a KOL
curl -X POST http://localhost:3000/api/kols/<id>/style-learn

# Check KOL stats
curl http://localhost:3000/api/kols/<id>/stats
```

Style learning runs automatically on first KOL creation and after every 10 new crawled posts.

---

## 5. Set the bot mode

Control whether comments are posted automatically or require your approval:

```bash
# In Telegram — send these commands to your bot:
/manual    # Comments go to approval queue (default)
/afk       # Comments auto-post without review
/status    # Show current mode + pending count
```

Or set via Redis directly:
```bash
redis-cli SET bot:mode manual   # or: afk
```

---

## 6. Approval workflow (Manual mode)

When a new KOL post is processed in `manual` mode, your Telegram bot sends:

```
🔔 New KOL Post — @handle

📝 Summary: ...
📊 Sentiment: 🟢 60% positive · ⚪ 30% neutral · 🔴 10% negative
💬 Crowd is mostly excited about this

[🟢 Option 1: great take on this fr...]
[⚪ Option 2: interesting perspective...]
[🔴 Option 3: not sure about this...]
[❌ Reject all]  [🔄 Regenerate]
```

- Click an option to approve and post it (with 1-3 min anti-ban delay)
- **No action in 5 minutes** → best candidate auto-posts (timeout fallback)
- After posting, 3 visibility checks run at 5-min intervals to confirm the comment wasn't collapsed or flagged

---

## 7. Crawl schedule

The crawler runs automatically every 45 minutes via `@Cron`. KOLs are batched (10 per batch, staggered 2 min apart) to avoid rate limits.

To trigger a manual crawl immediately:

```bash
# Crawl all active KOLs now
curl -X POST http://localhost:3000/api/crawler/trigger

# Crawl a specific KOL
curl -X POST http://localhost:3000/api/crawler/trigger?kolId=<id>
```

---

## 8. Monitor pending comments

```bash
# View pending review queue
curl "http://localhost:3000/api/kol-posts?status=NEW"

# View processed posts with candidates
curl "http://localhost:3000/api/kol-posts/<id>/processing"
curl "http://localhost:3000/api/kol-posts/<id>/comments"
```

---

## 9. Run tests

```bash
npm test               # Run all tests once
npm run test:watch     # Watch mode
npm run test:cov       # With coverage report
```

Current coverage: **86 tests across 11 suites**.

---

## Architecture Overview

```
@Cron (45 min)
  └─ CrawlerService → BullMQ kol-crawl queue
       └─ CrawlerProcessor → OpenClaw CLI (crawl KOL profile)
            └─ POST /api/tools/kol/:id/posts/ingest
                 └─ BullMQ ai-pipeline queue

AiProcessingProcessor
  ├─ Step 1: gpt-4o-mini  → summarize post
  ├─ Step 2: gpt-4o-mini  → crowd sentiment (JSON)
  └─ Step 3: gpt-4o       → 3 comment candidates (few-shot embeddings)
       ├─ AFK mode  → BullMQ engagement queue (1-3 min delay)
       └─ Manual    → BullMQ telegram-approval queue

TelegramApprovalProcessor
  ├─ Sends inline keyboard to admin chat
  ├─ Registers 5-min timeout-fallback job per candidate
  └─ On button click / timeout → BullMQ engagement queue

EngagementProcessor
  ├─ OpenClaw posts comment on X.com
  └─ 3× visibility checks at 5-min intervals
       └─ POSTED / FAILED final status
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `openclaw: command not found` | Install OpenClaw and ensure it's in PATH |
| Telegram bot not responding | Check `TELEGRAM_BOT_TOKEN` and that bot is started (`/start`) |
| Comments not posting | Check `PUBLIC_API_URL` is reachable from OpenClaw's machine |
| Prisma errors on startup | Run `npx prisma generate` then restart |
| Redis connection refused | Start Redis: `redis-server` |
| OpenAI 429 errors | GPT-4o rate limit — reduce active KOL count or increase crawl interval |
