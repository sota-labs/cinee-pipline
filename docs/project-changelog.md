# Project Changelog

**Last Updated:** 2026-05-18

All notable changes to the cinee-pipeline project are documented here.

---

## [2026-05-18] - Own Account Post Seeding for AI Learning

### Added
- **Own Account Crawler Service** (`src/services/ownAccountCrawlerService.ts`)
  - `queueCrawlTask(options)` — creates SINGLE_TASK_TRIGGER Task for OpenClaw to crawl own account
  - `processCrawlResult(rawResult, limit)` — parses JSON from cinee-worker and seeds posts
  - `countSeedPosts()` — returns count of seeded posts available for learning
  - Options: `{ daysBack?: number (default 30), limit?: number (default 100) }`
  
- **Seed Own Account Posts Script** (`src/scripts/seedOwnAccountPostsCron.ts`)
  - Entry point for seeding own account posts
  - Supports CLI args: `--days <n>` and `--limit <n>`
  - Exports `runSeedOwnAccountPosts()` function
  
- **Account Post Seeding API Routes** (enhanced `src/routes/account.ts`)
  - `POST /api/account/posts/seed` — queue crawl task via API
  - `POST /api/account/posts/seed/result` — receive crawl result and seed posts
  - `GET /api/account/posts/seed/count` — get count of seeded posts
  
- **npm Script** (`package.json`)
  - `npm run own-account:seed-posts` — seed own account posts for learning

### Workflow
1. Run: `npm run own-account:seed-posts [--days 30] [--limit 100]` or `POST /api/account/posts/seed`
2. Creates SINGLE_TASK_TRIGGER Task in MongoDB
3. cinee-worker picks up task, crawls x.com/<X_USERNAME>
4. cinee-worker calls: `POST /api/account/posts/seed/result { result: "<JSON>" }`
5. Posts seeded into Post collection with status: POSTED
6. ownAccountService.learnPersonality() now has data to learn from
7. Daily cron (ownAccountLearnCron) runs at 03:00 AM to learn personality

### Technical Details
- Deduplicates posts by post_url to prevent duplicates
- Supports configurable date range (daysBack) and post limit
- Integrates seamlessly with existing personality learning pipeline
- Posts marked with status: POSTED for learning purposes

---

## [2026-05-14] - Own Account Personality Learning + Self-Reply AI Integration

### Added
- **OwnAccountProfile Model** (`src/db/models/OwnAccountProfile.ts`)
  - Singleton Mongoose model storing manual config, learned profile, and effective profile
  - Tracks personality traits, writing patterns, and engagement style
  
- **Own Account Learning Service** (`src/services/ownAccountService.ts`)
  - `getProfile()` — retrieve current personality profile
  - `updateManualConfig()` — manually override personality settings
  - `learnPersonality()` — analyze own tweets and extract personality traits
  - `applyLearnedProfile()` — merge learned traits into effective profile
  - `mergeProfiles()` — combine manual config with learned profile
  
- **Own Account Prompts** (`src/prompts/ownAccountPrompts.ts`)
  - `OWN_ACCOUNT_LEARNING_PROMPT` — template for analyzing own tweets
  - `buildOwnAccountLearningPrompt()` — dynamic prompt builder
  
- **Own Account Learning Cron** (`src/scripts/ownAccountLearnCron.ts`)
  - Daily cron job at 03:00 AM
  - Analyzes recent own tweets to learn personality
  - Creates Task record for OpenClaw execution
  
- **Account Personality API Routes** (`src/routes/account.ts`)
  - `GET /api/account/personality` — retrieve current profile
  - `PATCH /api/account/personality` — update manual config
  - `POST /api/account/personality/learn` — trigger immediate learning
  
- **Self-Reply AI Generation** (enhanced `src/services/selfReplyService.ts`)
  - Replaced hardcoded `generateReplyContent()` stub
  - `queueSelfReplyGeneration()` — queue reply for AI generation
  - `processSelfReplyResult()` — handle webhook response from OpenClaw
  - `storeForManualReview()` — store generated replies for manual review
  - Applies learned personality to all generated replies
  
- **Webhook Integration** (enhanced `src/routes/tasks.ts`)
  - Added `own_account_personality` task type handler
  - Added `self_reply_generation` task type handler
  - Calls `ownAccountService.learnPersonality()` on completion
  - Calls `selfReplyService.processSelfReplyResult()` on completion

### Modified
- **Reply Engine Service** (`src/services/replyEngineService.ts`)
  - Added personality guard to validate learned profile before generating replies
  - Integrated `kolAnalyzerService` for enhanced context analysis
  
- **App Wiring** (`src/app.ts`)
  - Mounted `/api/account` route for personality management

### Technical Details
- All relative imports use `.js` extension (Node16 module resolution)
- Personality learning uses OpenClaw Task queue (cinee-worker executes CLI commands)
- Self-reply generation respects `KolSettings.default_mode` (AFK vs Manual)
- Task webhook discriminator uses `payload.analysisType` (not `task.type`)

### Testing
- All phases completed and integrated
- Feature ready for production deployment

---

## Previous Versions

(To be added as project history grows)
