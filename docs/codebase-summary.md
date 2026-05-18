# Codebase Summary

**Last Updated:** 2026-05-18

## Directory Structure

```
src/
├── app.ts                    # Express application setup
├── index.ts                  # Server entry point
├── config/
│   └── settings.ts           # Configuration and environment mapping
├── db/
│   ├── connection.ts         # MongoDB connection
│   ├── redis.ts              # Redis client initialization
│   └── models/               # Mongoose schemas (15 models)
├── prompts/
│   ├── index.ts              # Barrel export
│   ├── humanStyleRules.ts    # Human-like writing rules
│   ├── promptBuilder.ts      # Dynamic prompt builders
│   ├── ownAccountPrompts.ts  # Own account learning prompts
│   └── outputFormat.ts       # Output format instructions
├── routes/                   # Express route handlers (11 routes)
├── scripts/                  # Cron job and utility scripts
├── services/                 # Business logic services (11 services)
├── tools/
│   ├── contentTools.ts       # Content manipulation utilities
│   ├── memoryTools.ts        # Memory/context management
│   └── rateLimiter.ts        # Rate limiting logic
└── utils/
    ├── logger.ts             # Centralized logging
    ├── kolCrawlScript.ts     # KOL crawl automation scripts
    └── kolCrawlResultParser.ts # Parse crawl results
```

## Data Models (15 Total)

| Model | Purpose | Key Fields |
|-------|---------|-----------|
| **Task** | Async job queue for OpenClaw | type, agent, prompt, status, result, error_log |
| **OwnAccountProfile** | CEO personality profile | manual_config, learned_profile, effective_profile |
| **KolProfile** | KOL personality & metrics | handle, personality_profile, reputation_score, last_crawled_at |
| **KolPost** | Crawled KOL posts | kol_id, content, likes, comments, status |
| **KolReplySuggestion** | AI-generated replies for KOL posts | post_id, suggested_reply, confidence_score |
| **KolReputationCache** | KOL reputation snapshots | kol_id, reputation_score, timestamp |
| **KolSettings** | Global KOL engagement config | default_mode (afk/manual), crawl_interval, safety settings |
| **SelfReplyQueue** | Pending self-replies for review | post_id, reply_text, status, created_at |
| **Post** | Published posts/tweets | content, status, published_at |
| **Reply** | Replies to posts | post_id, content, status |
| **Interaction** | User interactions & engagement | type, target_id, metadata |
| **PriorityAccount** | High-priority accounts to monitor | handle, priority_level, last_checked |
| **TopicConfig** | Dynamic topic/domain configuration | name, role_config, is_active |
| **PersonaKnowledge** | CEO persona and knowledge base | topics, keywords, context |
| **CurationSource** | Content sources for research | url, category, last_crawled |

## Services (12 Total)

| Service | Responsibility | Key Methods |
|---------|-----------------|------------|
| **ownAccountService** | CEO personality learning | getProfile(), updateManualConfig(), learnPersonality() |
| **ownAccountCrawlerService** | Own account post seeding | queueCrawlTask(), processCrawlResult(), countSeedPosts() |
| **selfReplyService** | Self-reply generation | queueSelfReplyGeneration(), processSelfReplyResult() |
| **replyEngineService** | Reply validation & personality | validateReply(), applyPersonality() |
| **kolCrawlerService** | KOL post crawling | crawlKolPosts(), updateCrawlCache() |
| **kolAnalyzerService** | KOL personality analysis | analyzeKolPersonality(), updateReputation() |
| **reputationCheckerService** | Reputation scoring | calculateReputation(), updateCache() |
| **priorityAccountService** | Priority account management | getPriorityAccounts(), updatePriority() |
| **schedulerService** | Task scheduling & cron | createTask(), getTasks(), updateTaskStatus() |
| **topicConfigService** | Dynamic topic switching | getActiveConfig(), activateConfig(), deactivateAll() |
| **statusService** | System status reporting | getSystemStatus(), getTaskStats() |
| **schedulerPrompts** | Prompt templates for scheduler | buildSchedulerPrompt() |

## API Routes (14 Total)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/account/personality` | GET | Retrieve CEO personality profile |
| `/api/account/personality` | PATCH | Update manual personality config |
| `/api/account/personality/learn` | POST | Trigger immediate learning |
| `/api/account/posts/seed` | POST | Queue own account crawl task |
| `/api/account/posts/seed/result` | POST | Receive crawl result and seed posts |
| `/api/account/posts/seed/count` | GET | Get count of seeded posts |
| `/api/kols` | GET | List all tracked KOLs |
| `/api/kols` | POST | Add new KOL to track |
| `/api/kols/:id` | GET | Get KOL details |
| `/api/kols/:id` | PATCH | Update KOL settings |
| `/api/kol-posts` | GET | List KOL posts |
| `/api/kol-posts/:id` | GET | Get post details |
| `/api/kol-settings` | GET | Get global KOL settings |
| `/api/kol-settings` | PATCH | Update KOL settings |
| `/api/priority-accounts` | GET | List priority accounts |
| `/api/priority-accounts` | POST | Add priority account |
| `/api/topic-config` | GET | List all topic configs |
| `/api/topic-config` | POST | Create topic config |
| `/api/topic-config/:id` | PATCH | Update topic config |
| `/api/topic-config/:id/activate` | POST | Activate topic config |
| `/api/topic-config/deactivate-all` | POST | Revert to default |
| `/api/tasks/webhook` | POST | Handle task completion |
| `/api/scheduler` | GET | Get scheduler status |
| `/api/status` | GET | Get system status |

## Cron Jobs (9 Total)

| Job | Script | Schedule | Purpose |
|-----|--------|----------|---------|
| **own-account-seed-posts** | seedOwnAccountPostsCron.ts | On-demand | Seed own account posts for AI learning |
| **kol-crawl** | kolCrawlCron.ts | Every 30 min | Crawl posts from tracked KOLs |
| **kol-analyze** | kolAnalyzeCron.ts | Every 60 min | Analyze KOL personalities |
| **kol-afk-reply** | kolAFKReplyCron.ts | Every 5 min | Auto-reply in AFK mode |
| **self-reply** | selfReplyCron.ts | Every 2 min | Process self-reply queue |
| **own-account-learn** | ownAccountLearnCron.ts | Daily 03:00 AM | Learn CEO personality |
| **daily-rolling-window** | dailyRollingWindowCron.ts | Daily | Rolling window analysis |
| **scan-and-post** | scanAndPostCron.ts | Configurable | Scan and post content |
| **kol-daemon** | kolDaemon.ts | Continuous | KOL engagement daemon |

## Key npm Scripts

```bash
npm run dev                    # Start dev server with tsx watch
npm run build                  # Compile TypeScript
npm run start                  # Run compiled server
npm run test                   # Run tests with vitest
npm run test:watch            # Watch mode testing
npm run typecheck             # Type check without emit

# Cron job management
npm run cron:add-all          # Register all cron jobs
npm run cron:remove-all       # Remove all cron jobs
npm run cron:add <job-name>   # Add specific job
npm run cron:remove <job-name> # Remove specific job

# Own account post seeding
npm run own-account:seed-posts # Seed own account posts for learning

# KOL-specific
npm run kol:crawl             # Run KOL crawl immediately
npm run kol:analyze           # Run KOL analysis immediately
npm run kol:daemon            # Start KOL engagement daemon
```

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
| `ROLE_CONFIG_PATH` | Path to role config JSON | (optional) |

### RoleConfig Structure

```typescript
{
  name: string;                    // Role name
  brand: string;                   // Brand name
  founderName: string;             // Founder name
  website: string;                 // Company website
  companyStage: string;            // Stage (building, growth, etc.)
  persona: string;                 // Detailed persona description
  tone: string;                    // Writing tone
  topics: string[];                // Topics to discuss
  communities: string[];           // Communities to engage
  engagementKeywords: string[];    // Keywords for engagement
  searchKeywords?: string[];       // Keywords for X search
  slangExamples?: string[];        // Domain-specific slang
  blacklistedWords?: string[];     // Words to avoid
  brandMentionBan?: string[];      // Brands to never mention
  humanStyleLevel?: "mild" | "moderate" | "heavy";
}
```

## Key Workflows

### Own Account Post Seeding
1. Run: `npm run own-account:seed-posts [--days 30] [--limit 100]` or `POST /api/account/posts/seed`
2. Creates SINGLE_TASK_TRIGGER Task in MongoDB
3. cinee-worker picks up task, crawls x.com/<X_USERNAME>
4. cinee-worker calls: `POST /api/account/posts/seed/result { result: "<JSON>" }`
5. Posts seeded into Post collection with status: POSTED
6. ownAccountService.learnPersonality() now has data to learn from
7. Daily cron (ownAccountLearnCron) runs at 03:00 AM to learn personality

### Own Account Personality Learning
1. Daily cron (03:00 AM) triggers learning
2. Creates Task record in MongoDB
3. OpenClaw executes analysis
4. Webhook callback processes result
5. Updates OwnAccountProfile.learned_profile
6. Merges with manual_config into effective_profile

### KOL Crawl → Analyze → Reply
1. KOL crawl cron fetches posts from tracked KOLs
2. Posts stored in KolPost collection
3. KOL analyze cron processes posts
4. Personality profiles updated in KolProfile
5. Reply suggestions generated in KolReplySuggestion
6. AFK mode: auto-post; Manual mode: queue for review

### Self-Reply Generation
1. Comment detected on CEO's post
2. SelfReplyService queues reply generation
3. OpenClaw generates reply using learned personality
4. Webhook processes result
5. Manual mode: store in SelfReplyQueue for review
6. AFK mode: auto-post reply
