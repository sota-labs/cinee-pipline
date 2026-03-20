# Cinee Pipeline

CEO automation pipeline for [cinee.com](https://cinee.com). Uses **OpenClaw** browser automation to run the founder's social media presence on X (Twitter) — researching AI filmmaking trends, posting hot takes, and replying to mentions — all autonomously.

## Architecture

```
┌─────────────────────────────────────────────────┐
│               OpenClaw (Browser Agent)          │
│  Runs isolated cron jobs: search, post, reply   │
│  on x.com autonomously via browser automation   │
└──────────────────────┬──────────────────────────┘
                       │ REST calls
┌──────────────────────▼──────────────────────────┐
│            Node.js / Express (port 3000)        │
│                                                 │
│  /api/tools/db/posts       ← Post CRUD          │
│  /api/tools/db/replies     ← Reply CRUD          │
│  /api/tools/db/curation    ← AI film sources     │
│  /api/tools/db/persona     ← CEO stances         │
│  /api/tools/memory/*       ← Redis memory        │
│  /api/scheduler/*          ← Cron management     │
└──────────────────────┬──────────────────────────┘
                       │
              ┌────────▼────────┐
              │    MongoDB      │
              │  + Redis cache  │
              └─────────────────┘
```

**How it works:**

1. `npx tsx src/scripts/setupCronJobs.ts` registers isolated cron jobs in OpenClaw.
2. OpenClaw runs each job on schedule — it opens a browser, executes the prompt (search X, compose a post, click "Post", etc.), then calls back to the Node.js REST API to persist results.
3. The Node.js server is a thin data layer: MongoDB for structured data, Redis for short-term memory. No AI logic lives here.

## Project Structure

```
src/
├── index.ts                       ← Entry point (MongoDB connect + Express)
├── app.ts                         ← Route mounting
├── config/settings.ts             ← Env-based configuration
├── db/
│   ├── connection.ts              ← Mongoose connection
│   └── models/
│       ├── Post.ts                ← CEO's posts (draft → posted)
│       ├── Reply.ts               ← Replies to mentions (draft → resolved → replied)
│       ├── CurationSource.ts      ← AI films found for amplification
│       └── PersonaKnowledge.ts    ← CEO stances on key topics
├── routes/
│   ├── tools.ts                   ← CRUD for all collections + memory + content
│   ├── scheduler.ts               ← Register/list/remove OpenClaw cron jobs
│   └── status.ts                  ← Health check + daily stats
├── scripts/
│   └── setupCronJobs.ts           ← One-time: register cron jobs in OpenClaw
├── services/
│   ├── schedulerService.ts        ← OpenClaw cron job definitions + prompts
│   └── statusService.ts           ← Quick stats from MongoDB
├── tools/
│   ├── memoryTools.ts             ← Redis key-value memory
│   ├── contentTools.ts            ← Character count, formatting, sentiment
│   └── rateLimiter.ts             ← Rate limiting
└── utils/
    └── logger.ts
```

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB running locally (or provide `MONGO_URI`)
- Redis running locally (or provide `REDIS_URL`)
- [OpenClaw CLI](https://docs.openclaw.ai) installed and authenticated

### 1. Install & Configure

```bash
npm install
cp .env.example .env
# Edit .env with your values
```

Required environment variables:

| Variable | Description |
|---|---|
| `MONGO_URI` | MongoDB connection string |
| `REDIS_URL` | Redis connection string |
| `PUBLIC_API_URL` | Public URL of this server (used in OpenClaw prompts) |
| `FOUNDER_NAME` | CEO name for persona |

### 2. Start the Server

```bash
npm run dev
```

### 3. Register Cron Jobs

```bash
npm run setup-cron
# or: npx tsx src/scripts/setupCronJobs.ts
```

This registers 4 isolated cron jobs in OpenClaw:

| Job | Schedule | What it does |
|---|---|---|
| `scrape_x_notifications` | Every hour at :00 | Scrape X notifications, save to `/db/replies` |
| `reply_x_notifications` | Every hour at :30 | Reply to resolved mentions as CEO |
| `research_and_post_morning` | 10 AM daily | Research AI film trends, post on X |
| `research_and_post_evening` | 6 PM daily | Research AI film trends, post on X |

### 4. Verify

```bash
openclaw cron list          # Check registered jobs
curl localhost:3000/api/health    # Server health
curl localhost:3000/api/status    # Daily stats
```

## API Endpoints

### Database CRUD (`/api/tools/db/`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/db/posts` | Create a post |
| `GET` | `/db/posts` | List posts (`?status=&content_type=&limit=&skip=`) |
| `GET` | `/db/posts/:id` | Get single post |
| `PATCH` | `/db/posts/:id` | Update post (status, metadata) |
| `POST` | `/db/replies` | Create replies (array or single) |
| `GET` | `/db/replies` | List replies (`?status=draft,resolved&platform=x`) |
| `GET` | `/db/replies/:id` | Get single reply |
| `PATCH` | `/db/replies/:id` | Mark reply as replied (requires status=resolved) |
| `DELETE` | `/db/replies/:id` | Delete reply |
| `POST` | `/db/curation` | Save AI film source (idempotent by URL) |
| `GET` | `/db/curation` | Get unused sources |
| `PATCH` | `/db/curation/:id/used` | Mark source as used |
| `POST` | `/db/persona` | Upsert CEO topic stance |
| `GET` | `/db/persona` | Get all persona knowledge |
| `GET` | `/db/stats` | Today's pipeline statistics |

### Memory (`/api/tools/memory/`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/memory/store` | Store key-value in Redis |
| `GET` | `/memory/retrieve` | Retrieve by key |
| `POST` | `/memory/search` | Search memories |
| `POST` | `/memory/history` | Store content history |
| `GET` | `/memory/recent-history` | Get recent history |

### Scheduler (`/api/scheduler/`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/setup` | Register all cron jobs |
| `GET` | `/jobs` | List cron jobs |
| `DELETE` | `/jobs` | Remove all cron jobs |
| `GET` | `/check` | OpenClaw gateway health |
