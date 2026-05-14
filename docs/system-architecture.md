# System Architecture

**Last Updated:** 2026-05-14

## Overview

The cinee-pipeline is a CEO automation system built on TypeScript/Node.js that learns the CEO's writing style and generates authentic AI-powered content and replies.

---

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Runtime | Node.js + TypeScript | Server-side application |
| Web Server | Express | HTTP API and routing |
| Database | MongoDB + Mongoose | Data persistence |
| Cache | Redis (ioredis) | Session and task caching |
| Automation | OpenClaw | CLI command execution |
| Task Queue | MongoDB Task Records | Async job scheduling |

---

## Core Architecture

### Layered Architecture

```
┌─────────────────────────────────────┐
│      Express Routes Layer           │
│  (routes/, API endpoints)           │
├─────────────────────────────────────┤
│      Services Layer                 │
│  (services/, business logic)        │
├─────────────────────────────────────┤
│      Data Access Layer              │
│  (db/models/, Mongoose schemas)     │
├─────────────────────────────────────┤
│      External Systems               │
│  (OpenClaw, Redis, MongoDB)         │
└─────────────────────────────────────┘
```

---

## Data Models

### Core Models

| Model | Purpose | Location |
|-------|---------|----------|
| `CurationSource` | Content sources for research | `src/db/models/` |
| `PersonaKnowledge` | CEO persona and knowledge base | `src/db/models/` |
| `Post` | Published posts/tweets | `src/db/models/` |
| `Reply` | Replies to posts | `src/db/models/` |
| `Interaction` | User interactions and engagement | `src/db/models/` |
| `PriorityAccount` | High-priority accounts to monitor | `src/db/models/` |
| `TopicConfig` | Dynamic topic/domain configuration | `src/db/models/` |
| `OwnAccountProfile` | CEO's own writing style and personality | `src/db/models/OwnAccountProfile.ts` |

### OwnAccountProfile Schema

```typescript
{
  _id: ObjectId,
  _key: string,  // Singleton key: "own_account"
  manual_config: {
    writing_style: string,
    slang_words: string[],
    emoji_pattern: string,
    sentence_structure: string,
    engagement_tone: string,
    avg_post_length: number
  },
  learned_profile: {
    writing_style: string,
    slang_words: string[],
    emoji_pattern: string,
    sentence_structure: string,
    engagement_tone: string,
    avg_post_length: number,
    last_learned_at: Date | null,
    posts_analyzed: number,
    learning_confidence: number  // 0-100
  },
  effective_profile: {
    // Merged result of manual_config + learned_profile
    writing_style: string,
    slang_words: string[],
    emoji_pattern: string,
    sentence_structure: string,
    engagement_tone: string,
    avg_post_length: number
  },
  created_at: Date,
  updated_at: Date
}
```

### KOL Models Schema

**KolProfile** — Tracks KOL personality and metrics
```typescript
{
  handle: string,  // Unique, lowercase
  display_name: string,
  bio: string,
  follower_count: number,
  is_verified: boolean,
  personality_profile: {
    writing_style: string,
    common_topics: string[],
    slang_words: string[],
    emoji_pattern: string,
    engagement_tone: string,
    avg_post_length: number
  },
  reputation_score: number,  // 0-100
  last_crawled_at: Date | null,
  is_active: boolean
}
```

**KolPost** — Crawled posts from KOLs
```typescript
{
  kol_id: ObjectId,
  content: string,
  likes: number,
  comments: number,
  retweets: number,
  status: "pending" | "analyzed" | "replied",
  created_at: Date
}
```

**KolReplySuggestion** — AI-generated replies
```typescript
{
  post_id: ObjectId,
  suggested_reply: string,
  confidence_score: number,
  status: "pending" | "approved" | "rejected"
}
```

**KolSettings** — Global KOL engagement configuration
```typescript
{
  default_mode: "afk" | "manual",
  crawl_interval_minutes: number,
  max_posts_per_crawl: number,
  afk: {
    min_confidence_threshold: number,
    auto_delay_min_minutes: number,
    hourly_reply_limit: number,
    daily_reply_limit: number
  },
  manual: {
    notification_channel: string,
    max_pending_hours: number
  },
  safety: {
    min_kol_trust_score: number,
    enable_duplicate_detection: boolean,
    max_hourly_replies_global: number
  }
}
```

---

## Service Layer

### Key Services

| Service | Responsibility | Location |
|---------|-----------------|----------|
| `schedulerService` | Task scheduling and cron management | `src/services/schedulerService.ts` |
| `ownAccountService` | CEO personality learning and management | `src/services/ownAccountService.ts` |
| `selfReplyService` | AI-powered reply generation | `src/services/selfReplyService.ts` |
| `replyEngineService` | Reply validation and personality application | `src/services/replyEngineService.ts` |
| `topicConfigService` | Dynamic topic configuration | `src/services/topicConfigService.ts` |
| `openclawAgentService` | OpenClaw integration | `src/services/openclawAgentService.ts` |

### OwnAccountService Methods

```typescript
getProfile(): Promise<OwnAccountProfile>
updateManualConfig(config: ManualConfig): Promise<OwnAccountProfile>
learnPersonality(tweets: Tweet[]): Promise<Task>
applyLearnedProfile(learned: LearnedProfile): Promise<OwnAccountProfile>
mergeProfiles(manual: ManualConfig, learned: LearnedProfile): EffectiveProfile
```

---

## Workflow: Own Account Personality Learning

```
1. Daily Cron (03:00 AM)
   └─> ownAccountLearnCron.ts triggers

2. Create Learning Task
   └─> Creates Task record in MongoDB
   └─> Queues for OpenClaw execution

3. OpenClaw Execution
   └─> cinee-worker polls and executes
   └─> Analyzes recent own tweets
   └─> Extracts personality traits

4. Webhook Callback
   └─> POST /api/tasks/webhook
   └─> Payload: { analysisType: 'own_account_personality', result: {...} }
   └─> ownAccountService.learnPersonality() processes result
   └─> Updates OwnAccountProfile.learned_profile

5. Profile Merge
   └─> Merges manual_config + learned_profile
   └─> Stores in effective_profile
   └─> Ready for reply generation
```

---

## Workflow: Self-Reply AI Generation

```
1. Comment Detected
   └─> Triggers reply generation workflow

2. Queue Reply Generation
   └─> selfReplyService.queueSelfReplyGeneration()
   └─> Creates Task record with learned personality

3. OpenClaw Execution
   └─> cinee-worker polls and executes
   └─> Generates reply using learned personality
   └─> Respects KolSettings.default_mode (AFK vs Manual)

4. Webhook Callback
   └─> POST /api/tasks/webhook
   └─> Payload: { analysisType: 'self_reply_generation', result: {...} }
   └─> selfReplyService.processSelfReplyResult() handles response

5. Store for Review
   └─> If Manual mode: selfReplyService.storeForManualReview()
   └─> If AFK mode: Auto-post reply
```

---

## API Routes

### Account Personality Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/account/personality` | Retrieve current personality profile |
| `PATCH` | `/api/account/personality` | Update manual personality config |
| `POST` | `/api/account/personality/learn` | Trigger immediate learning |

### KOL Management Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/kols` | List all tracked KOLs |
| `POST` | `/api/kols` | Add new KOL to track |
| `GET` | `/api/kols/:id` | Get KOL details and personality |
| `PATCH` | `/api/kols/:id` | Update KOL settings |

### KOL Posts Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/kol-posts` | List crawled KOL posts |
| `GET` | `/api/kol-posts/:id` | Get post details and reply suggestions |

### KOL Settings Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/kol-settings` | Get global KOL engagement settings |
| `PATCH` | `/api/kol-settings` | Update KOL settings (mode, limits, safety) |

### Topic Configuration Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/topic-config` | List all topic configs |
| `POST` | `/api/topic-config` | Create a new topic config |
| `PATCH` | `/api/topic-config/:id` | Update a topic config |
| `DELETE` | `/api/topic-config/:id` | Delete a topic config |
| `POST` | `/api/topic-config/:id/activate` | Switch active topic (deactivates all others) |
| `POST` | `/api/topic-config/deactivate-all` | Revert to settings.ts default |

### Priority Account Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/priority-accounts` | List priority accounts |
| `POST` | `/api/priority-accounts` | Add priority account |

### Task & Webhook Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/tasks/webhook` | Handle task completion callbacks from OpenClaw |

### System Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/scheduler` | Get scheduler status and pending tasks |
| `GET` | `/api/status` | Get system health and statistics |

---

## Workflow: KOL Crawl → Analyze → Reply

```
1. KOL Crawl Cron (Every 30 min)
   └─> kolCrawlCron.ts triggers
   └─> Fetches posts from tracked KOLs via OpenClaw
   └─> Stores in KolPost collection with status="pending"
   └─> Updates last_crawled_at in KolProfile

2. KOL Analyze Cron (Every 60 min)
   └─> kolAnalyzeCron.ts triggers
   └─> Analyzes pending KolPost records
   └─> Extracts personality traits and engagement patterns
   └─> Updates KolProfile.personality_profile
   └─> Generates reply suggestions in KolReplySuggestion

3. Reply Generation (AFK vs Manual Mode)
   └─> AFK Mode: Auto-post replies if confidence > threshold
   └─> Manual Mode: Queue in SelfReplyQueue for human review
   └─> Respects hourly/daily rate limits from KolSettings

4. Webhook Callback
   └─> POST /api/tasks/webhook
   └─> Updates KolPost.status to "replied"
   └─> Updates reputation scores in KolReputationCache
```

---

## Workflow: Self-Reply AI Generation

```
1. Comment Detected
   └─> Triggers reply generation workflow

2. Queue Reply Generation
   └─> selfReplyService.queueSelfReplyGeneration()
   └─> Creates Task record with learned personality
   └─> Stores in SelfReplyQueue with status="pending"

3. OpenClaw Execution
   └─> cinee-worker polls and executes
   └─> Generates reply using OwnAccountProfile.effective_profile
   └─> Respects KolSettings.default_mode (AFK vs Manual)

4. Webhook Callback
   └─> POST /api/tasks/webhook
   └─> Payload: { analysisType: 'self_reply_generation', result: {...} }
   └─> selfReplyService.processSelfReplyResult() handles response

5. Store for Review or Auto-Post
   └─> If Manual mode: selfReplyService.storeForManualReview()
   └─> If AFK mode: Auto-post reply with rate limiting
```

---

## Prompt System

### Dynamic Prompt Building

All prompts are built dynamically from the active `RoleConfig`:

```typescript
buildOwnAccountLearningPrompt(role: RoleConfig, api: ApiContext): string
buildReplyPrompt(role: RoleConfig, api: ApiContext): string
buildDraftPrompt(role: RoleConfig, api: ApiContext): string
```

### Human-like Writing Rules

All content prompts inject human-style rules:

```typescript
getHumanStyleRules("moderate") // Returns: no semicolons, no ellipsis, casual acronyms, occasional typos
```

---

## Configuration

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `MONGO_URI` | MongoDB connection string | mongodb://localhost:27017/cinee_pipeline |
| `REDIS_URL` | Redis connection string | redis://localhost:6379/0 |
| `PUBLIC_API_URL` | Public API endpoint | http://localhost:3000 |
| `PORT` | Server port | 3000 |
| `OPENCLAW_AGENT` | OpenClaw agent name | main |
| `X_USERNAME` | CEO's X/Twitter handle | (required) |
| `FOUNDER_NAME` | CEO/Founder name | Founder |
| `ROLE_CONFIG_PATH` | Path to role configuration JSON | (optional) |

### Dynamic Topic Configuration

Switch domains via:
- `POST /api/topic-config/:id/activate` — activate a TopicConfig
- `POST /api/topic-config/deactivate-all` — revert to settings.ts default

---

## Integration Points

### OpenClaw Integration

- **Task Creation**: Services create Task records in MongoDB
- **Task Execution**: cinee-worker polls and executes CLI commands
- **Webhook Callback**: Results posted back to `/api/tasks/webhook`
- **No Direct CLI**: This repo never executes CLI commands directly

### Redis Integration

- Session caching
- Rate limiting
- Temporary task state

### MongoDB Integration

- All data persistence
- Task queue storage
- Configuration management

---

## Security Considerations

- All user inputs validated before processing
- API routes require authentication (via middleware)
- Sensitive data (API keys) stored in environment variables
- Task payloads sanitized before OpenClaw execution
- Webhook signatures verified (if applicable)

---

## Performance Considerations

- Async/await for all I/O operations
- Connection pooling for MongoDB and Redis
- Cron jobs scheduled during off-peak hours
- Task queue prevents blocking operations
- Personality learning runs daily (not on-demand)

---

## Error Handling

- Centralized logging via `src/utils/logger.ts`
- Try-catch blocks for all async operations
- Graceful degradation for failed tasks
- Webhook retry logic for failed callbacks
