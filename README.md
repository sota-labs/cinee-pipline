# Cinee Pipeline

CEO automation pipeline for [cinee.com](https://cinee.com). Uses **OpenClaw** browser automation to run the founder's social media presence on X (Twitter) — researching AI filmmaking trends, drafting posts, and replying to mentions — all autonomously with a REST API human-in-the-loop review layer.

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

1. OpenClaw cron jobs run on schedule — opens a browser, searches X, scrapes trends, and generates draft content via AI.
2. Drafts are saved to MongoDB via `POST /api/content-review/drafts` with status `pending_review`.
3. A human reviews drafts via the REST API and calls **post-now**, **ai-rewrite**, **edit**, **schedule**, **approve**, or **reject**.
4. On `post-now`, OpenClaw opens the browser, posts to X, verifies the post was published, then marks the draft as `posted`.

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
│   ├── tools.ts                   ← DB CRUD for all collections
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
│   ├── schedulerPrompts.ts        ← Prompt templates for cron jobs
│   ├── topicConfigService.ts      ← Topic config DB queries + activation logic
│   ├── openclawAgentService.ts    ← Wrapper for OpenClaw text agent
│   ├── priorityAccountService.ts  ← Priority account business logic
│   └── statusService.ts           ← Quick stats from MongoDB
├── tools/
│   ├── contentTools.ts            ← Character count, formatting, sentiment
│   └── rateLimiter.ts             ← Rate limiting utilities
└── utils/
    └── logger.ts                  ← Structured logger (info / warn / error / debug)
```

---

## Prerequisites

| Requirement             | Notes                                                                            |
| ----------------------- | -------------------------------------------------------------------------------- |
| **Node.js 18+**         | Required for native ESM and `tsx`                                                |
| **MongoDB**             | Local instance or Atlas — set `MONGO_URI`                                        |
| **Redis**               | Local instance or managed — set `REDIS_URL`                                      |
| **OpenClaw CLI**        | Install from [docs.openclaw.ai](https://docs.openclaw.ai), must be authenticated |
| **X / Twitter account** | Set `X_USERNAME` for the posting agent                                           |

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

# Public URL of this server — used in OpenClaw prompts as the callback base URL.
PUBLIC_API_URL=http://localhost:3000

# ── Security ──────────────────────────────────────────────────────────────────
# All API routes require this key via x-api-key header or Authorization: Bearer <key>.
APP_API_KEY=your-secret-api-key

# Comma-separated list of allowed frontend origins for CORS.
# Leave empty to allow all origins (dev mode).
ALLOWED_ORIGINS=https://your-frontend.com

# ── X (Twitter) ───────────────────────────────────────────────────────────────
X_USERNAME=your_x_handle_without_at

# ── Persona ───────────────────────────────────────────────────────────────────
FOUNDER_NAME=Your Name

# ── OpenClaw Agent ────────────────────────────────────────────────────────────
OPENCLAW_AGENT=main

# ── Role Config Override (optional) ──────────────────────────────────────────
# Path to a JSON file that overrides the built-in RoleConfig.
# Useful for switching persona/domain without code changes.
# ROLE_CONFIG_PATH=/path/to/custom-role.json
```

### 3. Start MongoDB & Redis

```bash
# MongoDB
mongod --dbpath /data/db

# Redis
redis-server
```

Or using Docker:

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

### Production

```bash
npm run build   # Compile TypeScript → dist/
npm start       # Run compiled output
```

### Verify the Server is Running

```bash
curl http://localhost:3000/api/health
```

Expected:

```json
{ "status": "ok" }
```

---

## Registering Cron Jobs

Cron jobs run inside OpenClaw's isolated scheduler daemon. After the server is up, register them:

### Register All Jobs at Once

```bash
npm run cron:add-all
```

### Manage Individual Jobs

```bash
# Add
npm run cron:add:scrape            # scrape_x_notifications
npm run cron:add:reply             # reply_x_notifications
npm run cron:add:research-morning  # research_and_draft_morning
npm run cron:add:research-evening  # research_and_draft_evening
npm run cron:add:collect           # research_and_collect
npm run cron:add:post              # post_approved_content
npm run cron:add:auto-interact     # auto_interact_hot_posts

# Remove
npm run cron:remove:scrape
npm run cron:remove:reply
npm run cron:remove:research-morning
npm run cron:remove:research-evening
npm run cron:remove:post
npm run cron:remove:auto-interact

# Remove all
npm run cron:remove-all
```

### Cron Job Schedule

| Job Name                     | Schedule          | Description                                                |
| ---------------------------- | ----------------- | ---------------------------------------------------------- |
| `scrape_x_notifications`     | Every hour at :20 | Scrapes X notifications, evaluates and saves replies to DB |
| `reply_x_notifications`      | Every hour at :40 | Replies to resolved mentions as CEO (≤300 chars)           |
| `research_and_draft_morning` | 9:00 AM daily     | Searches X for AI film trends, creates a draft             |
| `research_and_draft_evening` | 9:00 PM daily     | Same as above, evening run                                 |
| `research_and_collect`       | Configurable      | Collects AI film content from curation sources             |
| `post_approved_content`      | Configurable      | Posts approved drafts to X automatically                   |
| `auto_interact_hot_posts`    | Configurable      | Engages with trending posts in the AI film space           |

### Verify Registered Jobs

```bash
openclaw cron list
```

---

## API Reference

---

### Health & Status

| Method | Endpoint      | Description          |
| ------ | ------------- | -------------------- |
| `GET`  | `/api/health` | Server health check  |
| `GET`  | `/api/status` | Daily pipeline stats |

---

### Content Review — Draft Lifecycle

| Method  | Endpoint                                    | Body                                    | Description                                            |
| ------- | ------------------------------------------- | --------------------------------------- | ------------------------------------------------------ |
| `POST`  | `/api/content-review/drafts`                | draft fields                            | Create a new draft (called by OpenClaw agent)          |
| `GET`   | `/api/content-review/drafts`                | —                                       | List drafts — `?status=pending_review&limit=20&skip=0` |
| `GET`   | `/api/content-review/drafts/:id`            | —                                       | Get a single draft                                     |
| `PATCH` | `/api/content-review/drafts/:id`            | `raw_content`, `status`, `scheduled_at` | Update draft fields                                    |
| `PATCH` | `/api/content-review/drafts/:id/approve`    | —                                       | Approve a draft                                        |
| `PATCH` | `/api/content-review/drafts/:id/reject`     | —                                       | Reject a draft                                         |
| `PATCH` | `/api/content-review/drafts/:id/schedule`   | `{ "scheduled_at": "ISO8601" }`         | Schedule a draft                                       |
| `POST`  | `/api/content-review/drafts/:id/post-now`   | —                                       | Post to X immediately via OpenClaw, mark as `posted`   |
| `POST`  | `/api/content-review/drafts/:id/ai-rewrite` | `{ "prompt": "..." }`                   | AI rewrite with optional instruction                   |
| `POST`  | `/api/content-review/drafts/:id/edit`       | `{ "content": "..." }`                  | Replace content, reset to `pending_review`             |

**Draft status flow:**

```
draft → pending_review → approved → posted
                       ↘ rejected
                       ↘ scheduled → posted
```

**Examples:**

```bash
# List all pending review drafts
curl "http://localhost:3000/api/content-review/drafts?status=pending_review"

# Post a draft immediately
curl -X POST http://localhost:3000/api/content-review/drafts/DRAFT_ID/post-now

# AI rewrite with instruction
curl -X POST http://localhost:3000/api/content-review/drafts/DRAFT_ID/ai-rewrite
  -d '{ "prompt": "make it shorter and add a question at the end" }'

# Manual content edit
curl -X POST http://localhost:3000/api/content-review/drafts/DRAFT_ID/edit
  -d '{ "content": "Updated post text here." }'

# Schedule a draft
curl -X PATCH http://localhost:3000/api/content-review/drafts/DRAFT_ID/schedule
  -d '{ "scheduled_at": "2026-04-20T09:00:00Z" }'
```

---

### Scheduler

| Method   | Endpoint                             | Description                         |
| -------- | ------------------------------------ | ----------------------------------- |
| `POST`   | `/api/scheduler/setup`               | Register all cron jobs in OpenClaw  |
| `GET`    | `/api/scheduler/jobs`                | List registered cron jobs           |
| `DELETE` | `/api/scheduler/jobs`                | Remove all cron jobs                |
| `DELETE` | `/api/scheduler/jobs/:jobId`         | Remove a single job by ID           |
| `POST`   | `/api/scheduler/jobs/:jobId/trigger` | Manually trigger a job              |
| `GET`    | `/api/scheduler/check`               | Check OpenClaw gateway connectivity |

---

### Topic Config — Dynamic Persona Switching

| Method   | Endpoint                           | Description                                  |
| -------- | ---------------------------------- | -------------------------------------------- |
| `GET`    | `/api/topic-config`                | List all topic configs                       |
| `GET`    | `/api/topic-config/active`         | Get the currently active RoleConfig          |
| `POST`   | `/api/topic-config`                | Create a new topic config                    |
| `PATCH`  | `/api/topic-config/:id`            | Update a topic config                        |
| `DELETE` | `/api/topic-config/:id`            | Delete a topic config                        |
| `POST`   | `/api/topic-config/:id/activate`   | Switch active topic (deactivates all others) |
| `POST`   | `/api/topic-config/deactivate-all` | Revert to `settings.ts` default              |

---

### Database Tools (`/api/tools/`)

#### Posts

| Method  | Endpoint                              | Description                                                  |
| ------- | ------------------------------------- | ------------------------------------------------------------ |
| `POST`  | `/api/tools/db/posts`                 | Create a post record                                         |
| `GET`   | `/api/tools/db/posts`                 | List posts — `?status=&content_type=&platform=&limit=&skip=` |
| `GET`   | `/api/tools/db/posts/:id`             | Get a single post                                            |
| `PATCH` | `/api/tools/db/posts/:id`             | Update post fields                                           |
| `GET`   | `/api/tools/db/posts/duplicate-check` | Check for duplicate — `?content=...&hours=48`                |

#### Replies

| Method   | Endpoint                    | Description                                                        |
| -------- | --------------------------- | ------------------------------------------------------------------ |
| `POST`   | `/api/tools/db/replies`     | Create reply records (single or array, default status: `resolved`) |
| `GET`    | `/api/tools/db/replies`     | List replies — `?status=draft,resolved&platform=x&limit=&skip=`    |
| `GET`    | `/api/tools/db/replies/:id` | Get a single reply                                                 |
| `PATCH`  | `/api/tools/db/replies/:id` | Mark reply as `replied` (must be in `resolved` status)             |
| `DELETE` | `/api/tools/db/replies/:id` | Delete a reply                                                     |

#### Curation Sources

| Method  | Endpoint                                     | Description                                                |
| ------- | -------------------------------------------- | ---------------------------------------------------------- |
| `POST`  | `/api/tools/db/curation`                     | Batch upsert sources (deduplicated by `source_url`)        |
| `GET`   | `/api/tools/db/curation`                     | List sources — `?status=&keyword_searched=&limit=&skip=`   |
| `GET`   | `/api/tools/db/curation/top`                 | Top N by engagement — `?hours=24&limit=5&status=new`       |
| `GET`   | `/api/tools/db/curation/interact-candidates` | Uninteracted sources for auto-engage — `?hours=24&limit=1` |
| `GET`   | `/api/tools/db/curation/:id`                 | Get a single source                                        |
| `PATCH` | `/api/tools/db/curation/:id`                 | Update source fields                                       |

#### Interactions

| Method | Endpoint                     | Description              |
| ------ | ---------------------------- | ------------------------ |
| `POST` | `/api/tools/db/interactions` | Record a new interaction |

#### Persona Knowledge

| Method | Endpoint                | Description                  |
| ------ | ----------------------- | ---------------------------- |
| `POST` | `/api/tools/db/persona` | Upsert a CEO topic stance    |
| `GET`  | `/api/tools/db/persona` | List stances — `?topic=defi` |

#### Stats

| Method | Endpoint              | Description                 |
| ------ | --------------------- | --------------------------- |
| `GET`  | `/api/tools/db/stats` | Today's pipeline statistics |

---

### Priority Accounts

| Method   | Endpoint                     | Description                |
| -------- | ---------------------------- | -------------------------- |
| `GET`    | `/api/priority-accounts`     | List all priority accounts |
| `POST`   | `/api/priority-accounts`     | Add a priority account     |
| `PATCH`  | `/api/priority-accounts/:id` | Update a priority account  |
| `DELETE` | `/api/priority-accounts/:id` | Remove a priority account  |

---

## Dynamic Topic Switching

The pipeline's persona and content topics can be switched at runtime without restarting the server.

**Via API (persisted in MongoDB):**

```bash
# Create a new topic config
curl -X POST http://localhost:3000/api/topic-config
  -d '{
    "name": "Crypto Founder",
    "brand": "MyProtocol",
    "founderName": "Alice",
    "topics": ["DeFi", "Layer 2", "Web3"]
  }'

# Activate it (all other configs are deactivated automatically)
curl -X POST http://localhost:3000/api/topic-config/CONFIG_ID/activate

# Revert to settings.ts default
curl -X POST http://localhost:3000/api/topic-config/deactivate-all
```

**Via JSON file (env override, applied on server start):**

```bash
# In .env
ROLE_CONFIG_PATH=/path/to/my-role.json
```

The JSON file accepts any subset of `RoleConfig` fields. Missing fields fall back to the default in `settings.ts`.

---

## Scripts Reference

| Command                             | Description                                    |
| ----------------------------------- | ---------------------------------------------- |
| `npm run dev`                       | Start dev server with hot reload (`tsx watch`) |
| `npm run build`                     | Compile TypeScript to `dist/`                  |
| `npm start`                         | Run compiled server (`node dist/index.js`)     |
| `npm test`                          | Run test suite with Vitest                     |
| `npm run typecheck`                 | Type-check without emitting files              |
| `npm run cron:add-all`              | Register all cron jobs in OpenClaw             |
| `npm run cron:remove-all`           | Remove all cron jobs from OpenClaw             |
| `npm run cron:add:scrape`           | Register `scrape_x_notifications`              |
| `npm run cron:add:reply`            | Register `reply_x_notifications`               |
| `npm run cron:add:research-morning` | Register morning research job                  |
| `npm run cron:add:research-evening` | Register evening research job                  |
| `npm run cron:add:collect`          | Register `research_and_collect`                |
| `npm run cron:add:post`             | Register `post_approved_content`               |
| `npm run cron:add:auto-interact`    | Register `auto_interact_hot_posts`             |
| `npm run scan-post`                 | Run the scan-and-post script manually          |
