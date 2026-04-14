# Cinee Pipeline

CEO automation pipeline for [cinee.com](https://cinee.com). Uses **OpenClaw** browser automation to run the founder's social media presence on X (Twitter) — researching AI filmmaking trends, drafting posts, replying to mentions — all autonomously with a human-in-the-loop review API.

---

## Table of Contents

- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running the App](#running-the-app)
- [Registering Cron Jobs](#registering-cron-jobs)
- [API Reference](#api-reference)
- [Dynamic Topic Switching](#dynamic-topic-switching)
- [Scripts Reference](#scripts-reference)

---

## Architecture

```text
┌─────────────────────────────────────────────────┐
│               OpenClaw (Browser Agent)          │
│  Runs isolated cron jobs: search, post, reply   │
│  on x.com autonomously via browser automation   │
└──────────────────────┬──────────────────────────┘
                       │ REST callbacks
┌──────────────────────▼──────────────────────────┐
│            Node.js / Express (port 3000)        │
│                                                 │
│  /api/content-review/*  ← Draft lifecycle       │
│  /api/telegram/*        ← Bot status & webhook  │
│  /api/tools/*           ← DB CRUD + memory      │
│  /api/scheduler/*       ← Cron management       │
│  /api/topic-config/*    ← Runtime topic switch  │
│  /api/status            ← Health & daily stats  │
└──────────────────────┬──────────────────────────┘
                       │
              ┌────────▼────────┐
              │    MongoDB      │
              │  + Redis cache  │
              └─────────────────┘
```

**Content pipeline flow:**

1. OpenClaw cron jobs run on schedule — opens a browser, searches X, scrapes trends, generates draft content.
2. Drafts are saved via `POST /api/content-review/drafts` and a Telegram notification is sent for visibility.
3. A human reviews the draft and calls the REST API to **post now**, **AI rewrite**, **edit**, **schedule**, **approve**, or **reject**.
4. On `post-now`, OpenClaw opens the browser, posts to X, verifies the post, and marks the draft as `POSTED`.

---

## Project Structure

```text
src/
├── index.ts                       ← Entry point (DB connect + Express server)
├── app.ts                         ← Middleware stack + route mounting
├── config/
│   └── settings.ts                ← Env-based config (RoleConfig + Settings)
├── db/
│   ├── connection.ts              ← Mongoose connection
│   └── models/
│       ├── Post.ts                ← Posts: draft → pending_review → posted
│       ├── Reply.ts               ← Replies to X mentions
│       ├── CurationSource.ts      ← AI film sources found for amplification
│       ├── PersonaKnowledge.ts    ← CEO stances on key topics
│       ├── PriorityAccount.ts     ← Accounts to watch / engage with
│       └── TopicConfig.ts         ← Runtime topic configuration records
├── middleware/
│   └── apiKeyAuth.ts              ← API key authentication (APP_API_KEY)
├── prompts/
│   ├── humanStyleRules.ts         ← Human-like writing style rules
│   ├── promptBuilder.ts           ← buildResearchPrompt, buildDraftPrompt, etc.
│   └── index.ts                   ← Barrel export
├── routes/
│   ├── contentReview.ts           ← Draft CRUD + post-now / ai-rewrite / edit
│   ├── telegram.ts                ← Telegram webhook + bot status
│   ├── tools.ts                   ← DB CRUD for all collections + Redis memory
│   ├── scheduler.ts               ← Register / list / remove OpenClaw cron jobs
│   ├── priorityAccounts.ts        ← Priority account management
│   ├── topicConfig.ts             ← Topic config CRUD + activation
│   └── status.ts                  ← Health check + daily stats
├── scripts/
│   ├── addAllJobs.ts              ← Register all cron jobs in OpenClaw
│   ├── removeAllJobs.ts           ← Remove all cron jobs from OpenClaw
│   ├── addJob.ts                  ← Register a single cron job by name
│   ├── removeJob.ts               ← Remove a single cron job by name
│   ├── dailyRollingWindowCron.ts  ← Daily rolling window job helper
│   └── scanAndPostCron.ts         ← Scan approved posts and post to X
├── services/
│   ├── schedulerService.ts        ← OpenClaw cron job definitions + prompt builders
│   ├── telegramService.ts         ← Telegram Bot API wrapper
│   ├── topicConfigService.ts      ← Topic config DB queries + activation logic
│   └── openclawAgentService.ts    ← Wrapper for OpenClaw text agent
├── tools/
│   ├── memoryTools.ts             ← Redis key-value memory helpers
│   ├── contentTools.ts            ← Character count, formatting, sentiment
│   └── rateLimiter.ts             ← Rate limiting utilities
└── utils/
    └── logger.ts                  ← Structured logger (info / warn / error / debug)
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js 18+** | Required for native ESM and `tsx` |
| **MongoDB** | Local instance or Atlas — set `MONGO_URI` |
| **Redis** | Local instance or managed — set `REDIS_URL` |
| **OpenClaw CLI** | Install from [docs.openclaw.ai](https://docs.openclaw.ai), must be authenticated |
| **Telegram Bot** (optional) | Create via [@BotFather](https://t.me/BotFather), needed for Telegram notifications |
| **X / Twitter account** | Set `X_USERNAME` for the posting agent |

---

## Setup

### 1. Clone & Install Dependencies

```bash
git clone <repo-url>
cd cinee-pipeline
npm install
```

### 2. Configure Environment Variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

Open `.env` and configure:

```env
# ── Data Stores ───────────────────────────────────────────────────────────────
MONGO_URI=mongodb://localhost:27017/cinee_pipeline
REDIS_URL=redis://localhost:6379/0

# ── Server ────────────────────────────────────────────────────────────────────
PORT=3000
NODE_ENV=development

# Public URL of this server — used in OpenClaw prompts and webhook registration.
# Use ngrok or a real domain for production / Telegram webhook.
PUBLIC_API_URL=http://localhost:3000

# ── Security ──────────────────────────────────────────────────────────────────
# All API routes require this key via x-api-key header or Authorization: Bearer <key>
APP_API_KEY=your-secret-api-key

# Comma-separated list of allowed frontend origins for CORS.
# Leave empty to allow all origins (useful for local dev).
ALLOWED_ORIGINS=https://your-frontend.com

# ── X (Twitter) ───────────────────────────────────────────────────────────────
X_USERNAME=your_x_handle_without_at

# ── Telegram Bot (optional — for draft notifications) ─────────────────────────
CINEE_TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
TELEGRAM_CHAT_ID=your_chat_id
TELEGRAM_WEBHOOK_URL=https://your-domain.com/api/telegram/webhook

# ── Persona ───────────────────────────────────────────────────────────────────
FOUNDER_NAME=Your Name

# ── Role Config Override (optional) ──────────────────────────────────────────
# Path to a JSON file that overrides the built-in RoleConfig.
# Useful for switching persona/domain without code changes.
# ROLE_CONFIG_PATH=/path/to/custom-role.json
```

### 3. Start MongoDB & Redis

Make sure both services are running before starting the app:

```bash
# MongoDB (macOS / Linux)
mongod --dbpath /data/db

# Redis
redis-server
```

Or use Docker:

```bash
docker run -d --name mongo -p 27017:27017 mongo:7
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

### 4. Authenticate OpenClaw

```bash
openclaw auth login
```

---

## Running the App

### Development (hot reload)

```bash
npm run dev
```

Starts the server with `tsx watch`. Any file change will auto-restart.

### Production

```bash
npm run build     # Compile TypeScript → dist/
npm start         # Run compiled output with node
```

### Verify the Server is Running

```bash
curl http://localhost:3000/api/health
```

Expected response:
```json
{ "status": "ok" }
```

---

## Registering Cron Jobs

Cron jobs run inside OpenClaw's isolated scheduler daemon. After the server is up, register jobs:

### Register All Jobs at Once

```bash
npm run cron:add-all
```

### Register or Remove Individual Jobs

```bash
# Add specific jobs
npm run cron:add:scrape            # scrape_x_notifications
npm run cron:add:reply             # reply_x_notifications
npm run cron:add:research-morning  # research_and_draft_morning
npm run cron:add:research-evening  # research_and_draft_evening
npm run cron:add:collect           # research_and_collect
npm run cron:add:post              # post_approved_content
npm run cron:add:auto-interact     # auto_interact_hot_posts

# Remove specific jobs
npm run cron:remove:scrape
npm run cron:remove:reply
npm run cron:remove:research-morning
npm run cron:remove:research-evening
npm run cron:remove:post
npm run cron:remove:auto-interact

# Remove all jobs
npm run cron:remove-all
```

### Cron Job Schedule

| Job Name | Schedule | Description |
|---|---|---|
| `scrape_x_notifications` | Every hour at :20 | Scrapes X notifications, evaluates and saves to DB |
| `reply_x_notifications` | Every hour at :40 | Replies to resolved mentions as CEO (≤300 chars) |
| `research_and_draft_morning` | 9:00 AM daily | Searches X for AI film trends, creates a draft |
| `research_and_draft_evening` | 9:00 PM daily | Same as above, evening run |
| `research_and_collect` | Configurable | Collects AI film content from curation sources |
| `post_approved_content` | Configurable | Posts approved drafts to X automatically |
| `auto_interact_hot_posts` | Configurable | Engages with trending posts in the AI film space |

### Verify Registered Jobs

```bash
openclaw cron list
```

---

## Telegram Webhook Setup (Optional)

If you want Telegram notifications when new drafts are created:

1. Expose your local server to the internet (e.g., with [ngrok](https://ngrok.com)):
   ```bash
   ngrok http 3000
   ```

2. Register the webhook:
   ```bash
   curl -X POST http://localhost:3000/api/telegram/setup \
     -H "Content-Type: application/json" \
     -H "x-api-key: your-secret-api-key" \
     -d '{ "webhook_url": "https://your-ngrok-url.ngrok.io/api/telegram/webhook" }'
   ```

3. Verify:
   ```bash
   curl http://localhost:3000/api/telegram/status \
     -H "x-api-key: your-secret-api-key"
   ```

---

## API Reference

All endpoints require the `x-api-key` header (or `Authorization: Bearer <key>`).

### Health & Status

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Server health check |
| `GET` | `/api/status` | Daily pipeline stats |

### Content Review — Draft Lifecycle

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/content-review/drafts` | Create a new draft (called by OpenClaw agent) |
| `GET` | `/api/content-review/drafts` | List drafts — `?status=pending_review,draft&limit=20&skip=0` |
| `GET` | `/api/content-review/drafts/:id` | Get a single draft |
| `PATCH` | `/api/content-review/drafts/:id` | Update draft fields (`raw_content`, `scheduled_at`, `status`) |
| `PATCH` | `/api/content-review/drafts/:id/approve` | Approve a draft |
| `PATCH` | `/api/content-review/drafts/:id/reject` | Reject a draft |
| `PATCH` | `/api/content-review/drafts/:id/schedule` | Schedule — body: `{ "scheduled_at": "2026-04-20T09:00:00Z" }` |
| `POST` | `/api/content-review/drafts/:id/post-now` | Post to X immediately via OpenClaw and mark as `POSTED` |
| `POST` | `/api/content-review/drafts/:id/ai-rewrite` | AI rewrite — body: `{ "prompt": "make it shorter and more punchy" }` |
| `POST` | `/api/content-review/drafts/:id/edit` | Manual edit — body: `{ "content": "New post text here" }` |

**Example — Post a draft immediately:**
```bash
curl -X POST http://localhost:3000/api/content-review/drafts/DRAFT_ID/post-now \
  -H "x-api-key: your-secret-api-key"
```

**Example — AI rewrite:**
```bash
curl -X POST http://localhost:3000/api/content-review/drafts/DRAFT_ID/ai-rewrite \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-api-key" \
  -d '{ "prompt": "make it shorter and add a question at the end" }'
```

**Example — Manual edit:**
```bash
curl -X POST http://localhost:3000/api/content-review/drafts/DRAFT_ID/edit \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-api-key" \
  -d '{ "content": "Updated post content goes here." }'
```

### Telegram

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/telegram/setup` | Register Telegram webhook — body: `{ "webhook_url": "..." }` |
| `POST` | `/api/telegram/webhook` | Receives Telegram updates (used by Telegram servers) |
| `GET` | `/api/telegram/status` | Telegram bot + webhook status |

### Topic Config (Dynamic Persona Switching)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/topic-config` | List all topic configs |
| `GET` | `/api/topic-config/active` | Get the currently active RoleConfig |
| `POST` | `/api/topic-config` | Create a new topic config |
| `PATCH` | `/api/topic-config/:id` | Update a topic config |
| `DELETE` | `/api/topic-config/:id` | Delete a topic config |
| `POST` | `/api/topic-config/:id/activate` | Switch active topic (deactivates all others) |
| `POST` | `/api/topic-config/deactivate-all` | Revert to `settings.ts` default |

### Database Tools (`/api/tools/`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/tools/db/posts` | Create a post record |
| `GET` | `/api/tools/db/posts` | List posts — `?status=&content_type=&limit=&skip=` |
| `PATCH` | `/api/tools/db/posts/:id` | Update post (status, metadata) |
| `POST` | `/api/tools/db/replies` | Create a reply record |
| `GET` | `/api/tools/db/replies` | List replies — `?status=draft,resolved&platform=x` |
| `PATCH` | `/api/tools/db/replies/:id` | Update reply (e.g., mark as replied) |
| `POST` | `/api/tools/db/persona` | Upsert a CEO topic stance |
| `GET` | `/api/tools/db/stats` | Today's pipeline statistics |
| `GET` | `/api/tools/memory/:key` | Read a Redis memory key |
| `POST` | `/api/tools/memory/:key` | Write a Redis memory key |
| `DELETE` | `/api/tools/memory/:key` | Delete a Redis memory key |

### Priority Accounts

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/priority-accounts` | List all priority accounts |
| `POST` | `/api/priority-accounts` | Add a priority account |
| `PATCH` | `/api/priority-accounts/:id` | Update a priority account |
| `DELETE` | `/api/priority-accounts/:id` | Remove a priority account |

### Scheduler

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/scheduler/jobs` | List registered OpenClaw cron jobs |
| `POST` | `/api/scheduler/jobs` | Register a new cron job |
| `DELETE` | `/api/scheduler/jobs/:name` | Remove a cron job by name |

---

## Dynamic Topic Switching

The pipeline's persona and content topics can be switched at runtime without restarting the server.

**Option 1 — Via API (persisted in MongoDB):**
```bash
# Create a new topic config
curl -X POST http://localhost:3000/api/topic-config \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-api-key" \
  -d '{
    "name": "Crypto Founder",
    "brand": "MyProtocol",
    "founderName": "Alice",
    "topics": ["DeFi", "Layer 2", "Web3"],
    ...
  }'

# Activate it
curl -X POST http://localhost:3000/api/topic-config/CONFIG_ID/activate \
  -H "x-api-key: your-secret-api-key"
```

**Option 2 — Via JSON file (env override):**
```bash
# In .env
ROLE_CONFIG_PATH=/path/to/my-role.json
```

The JSON file should contain any subset of `RoleConfig` fields — missing fields fall back to the default in `settings.ts`.

---

## Scripts Reference

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled server |
| `npm test` | Run test suite with Vitest |
| `npm run typecheck` | Type-check without emitting files |
| `npm run cron:add-all` | Register all cron jobs in OpenClaw |
| `npm run cron:remove-all` | Remove all cron jobs from OpenClaw |
| `npm run cron:add <name>` | Register a single job by name |
| `npm run cron:remove <name>` | Remove a single job by name |
| `npm run scan-post` | Run the scan-and-post script manually |
