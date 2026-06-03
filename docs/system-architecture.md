# System Architecture

**Last Updated:** 2026-06-03

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
  following_count: number,
  is_verified: boolean,
  account_age_days: number,
  tier: "S" | "A" | "B" | "C",  // Default: "B"
  personality_profile: {
    writing_style: string,
    common_topics: string[],
    slang_words: string[],
    emoji_pattern: string,
    engagement_tone: string,
    avg_post_length: number
  },
  reputation_score: number,  // 0-100
  avg_likes_per_post: number,
  avg_comments_per_post: number,
  avg_retweets_per_post: number,
  post_frequency: number,
  last_crawled_at: Date | null,
  is_active: boolean
}
```

**KolPost** — Crawled posts from KOLs
```typescript
{
  kol_id: ObjectId,
  platform: "twitter" | "reddit",
  post_url: string,
  content: string,
  media_urls: string[],
  posted_at: Date,
  likes: number,
  comments: number,
  retweets: number,
  views: number,
  engagement_score: number,
  status: "new" | "analyzed" | "pending_reply" | "replied" | "skipped",
  is_retweet: boolean,
  is_quote: boolean,
  quoted_post_url?: string,
  analysis: {
    summary: string,
    sentiment: "positive" | "negative" | "neutral",
    trending_topics: string[],
    virality_score: number
  },
  top_comments: ITopComment[],
  engagement_pattern: IEngagementPattern,
  crawled_at: Date,
  analyzed_at?: Date,
  replied_at?: Date
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
  max_comments_per_post: number,
  crawl_batch_size: number,
  analyze_batch_size: number,
  afk_skip_cashtag_whitelist: string[],  // Uppercase symbols, no $
  afk: {
    min_confidence_threshold: number,
    auto_delay_min_minutes: number,
    auto_delay_max_minutes: number,
    hourly_reply_limit: number,
    daily_reply_limit: number
  },
  manual: {
    notification_channel: string,
    max_pending_hours: number,
    auto_reject_after_minutes: number
  },
  self_reply: {
    enabled: boolean,
    min_comments_to_trigger: number,
    reply_interval_seconds: number,
    hourly_limit: number,
    priority_weights: IPriorityWeights
  },
  safety: {
    min_kol_trust_score: number,
    enable_duplicate_detection: boolean,
    enable_banned_words_filter: boolean,
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
| `ownAccountCrawlerService` | Own account post seeding | `src/services/ownAccountCrawlerService.ts` |
| `selfReplyService` | AI-powered reply generation | `src/services/selfReplyService.ts` |
| `replyEngineService` | Reply validation and personality application | `src/services/replyEngineService.ts` |
| `kolCrawlerService` | KOL post crawling and caching | `src/services/kolCrawlerService.ts` |
| `kolAnalyzerService` | KOL personality analysis | `src/services/kolAnalyzerService.ts` |
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

## Workflow: Own Account Post Seeding

```
1. Seed Posts Request
   └─> npm run own-account:seed-posts [--days 30] [--limit 100]
   └─> OR: POST /api/account/posts/seed { daysBack, limit }

2. Create Crawl Task
   └─> ownAccountCrawlerService.queueCrawlTask()
   └─> Creates SINGLE_TASK_TRIGGER Task in MongoDB
   └─> Task targets: x.com/<X_USERNAME>

3. OpenClaw Execution
   └─> cinee-worker polls and executes
   └─> Crawls own account posts from X/Twitter
   └─> Returns JSON with post data

4. Webhook Callback
   └─> POST /api/account/posts/seed/result { result: "<JSON>" }
   └─> ownAccountCrawlerService.processCrawlResult()
   └─> Parses JSON and deduplicates by post_url

5. Seed Posts into Database
   └─> Posts inserted into Post collection
   └─> Status set to: POSTED
   └─> Ready for personality learning

6. Personality Learning
   └─> ownAccountService.learnPersonality() uses seeded posts
   └─> Daily cron (03:00 AM) analyzes posts
   └─> Extracts personality traits and writing patterns
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

## Workflow: KOL Crawl → Analyze → Reply

KOL crawling uses a hybrid schedule (server-local time, default UTC). See
`docs/notes/prime-window-and-batch-schedule.md` for the rationale.

| Cron | Function | Tiers | Path |
|------|----------|-------|------|
| `*/15 * * * *` | `runPrimePolling` (in `kolScheduleService`) | S | X API poll (only inside `prime_window`) |
| `0 */1 * * *` | `runBatchCrawl(["S"])` | S (off-prime only — skips during prime window) | OpenClaw batch task |
| `0 */2 * * *` | `runBatchCrawl(["A"])` | A | OpenClaw batch task |
| `0 */3 * * *` | `runBatchCrawl(["B"])` | B | OpenClaw batch task |
| `0 */4 * * *` | `runBatchCrawl(["C"])` | C | OpenClaw batch task |

```
1. KOL Crawl (continuous; 5 jobs inside kolDaemon)
   └─> Tier S (prime window only): X API direct polling every 15 min
   └─> Tier S (off-prime): OpenClaw batch every 1h (skips if prime window active)
   └─> Tier A: OpenClaw batch every 2h
   └─> Tier B: OpenClaw batch every 3h
   └─> Tier C: OpenClaw batch every 4h
   └─> All paths write to KolPost collection (deduped by post_url)
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

## AFK Skip Rules

In AFK mode, the system automatically filters posts before generating replies. Posts matching any skip rule are marked as `skipped` and not replied to. **Tier S KOLs bypass all skip rules.**

### Skip Rule Evaluation

The `shouldSkipPost()` function in `src/utils/kolPostSkipRules.ts` evaluates posts against 5 rules:

**Rule 1: Retweets/Reposts**
- Skips posts where `is_retweet: true`
- Rationale: Focus on original content only

**Rule 2: Cashtag Whitelist**
- Skips posts containing cashtags (e.g., `$BTC`, `$ETH`) not in `afk_skip_cashtag_whitelist`
- Default whitelist: `WIF, BONK, PEPE, DOGE, SOL, BTC, ETH, BNB, BASE, SUI`
- Rationale: Avoid engagement with unvetted tokens

**Rule 3: Contract Addresses**
- Skips posts containing blockchain contract addresses:
  - EVM: `0x` + 40 hex chars
  - Solana: 32-44 base58 chars
  - Sui: `0x` + 64 hex chars
- Rationale: Avoid spam and scam tokens

**Rule 4: DEX/Pump Domains**
- Skips posts linking to: `dextools.io`, `dexscreener.com`, `pump.fun`, `letsbonk.fun`
- Rationale: Avoid engagement with trading platforms

**Rule 5: Quote Tweets with DEX URLs**
- Skips quote tweets where `quoted_post_url` contains DEX domains
- Rationale: Prevent indirect engagement with trading platforms

### KOL Tier Bypass

| Tier | Behavior |
|------|----------|
| **S** | Bypasses ALL skip rules — always replies if confidence > threshold |
| **A** | Applies rules 1, 3, 4, 5 (skips cashtag check) |
| **B** | Applies all 5 rules (default) |
| **C** | Applies all 5 rules (same as B) |

### Configuration

Update cashtag whitelist via API:
```bash
PATCH /api/kol-settings
{
  "afk_skip_cashtag_whitelist": ["WIF", "BONK", "PEPE", "DOGE", "SOL", "BTC", "ETH", "BNB", "BASE", "SUI"]
}
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

## API Routes

### Account Personality Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/account/personality` | Retrieve current personality profile |
| `PATCH` | `/api/account/personality` | Update manual personality config |
| `POST` | `/api/account/personality/learn` | Trigger immediate learning |

### Account Post Seeding Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/account/posts/seed` | Queue own account crawl task |
| `POST` | `/api/account/posts/seed/result` | Receive crawl result and seed posts |
| `GET` | `/api/account/posts/seed/count` | Get count of seeded posts |

### KOL Management Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/kols` | List all tracked KOLs with pagination and filters |
| `POST` | `/api/kols` | Add new KOL to track (accepts `tier` field) |
| `POST` | `/api/kols/bulk-import` | Bulk import KOLs (supports string[] or {handle, tier?}[]) |
| `GET` | `/api/kols/:id` | Get KOL details and personality |
| `PATCH` | `/api/kols/:id` | Update KOL settings (tier, reputation, etc.) |
| `DELETE` | `/api/kols/:id` | Delete KOL profile |
| `POST` | `/api/kols/:id/crawl` | Trigger manual crawl for KOL |
| `POST` | `/api/kols/:id/learn` | Trigger personality learning |
| `GET` | `/api/kols/:id/posts` | Get posts for a KOL |
| `GET` | `/api/kols/:id/personality` | Get KOL personality profile |

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
