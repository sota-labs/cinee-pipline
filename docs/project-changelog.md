# Project Changelog

**Last Updated:** 2026-05-21

All notable changes to the cinee-pipeline project are documented here.

---

## [2026-05-21] - Stronger Model for Analysis Tasks + Telegram Keyboard Fix

### Added

- **`openClawAnalysisModel` Setting** (`src/config/settings.ts`)
  - New field: `openClawAnalysisModel: string`
  - Env var: `OPENCLAW_ANALYSIS_MODEL` (default: `openrouter/anthropic/claude-sonnet-4.6`)
  - Allows overriding the AI model used for personality learning and reply suggestion tasks without changing other task types

### Modified

- **KOL Analyzer Service** (`src/services/kolAnalyzerService.ts`)
  - `queueAnalysisTask()` now accepts an optional `model?` parameter
  - `learnPersonality()` passes `settings.openClawAnalysisModel` — personality tasks now use the configured stronger model
  - All other task types (`post_analysis`, `comment_pattern`, crawl) remain unchanged

- **Reply Engine Service** (`src/services/replyEngineService.ts`)
  - `generate_suggestions` command now includes `--model ${appSettings.openClawAnalysisModel}` flag
  - Reply suggestion generation uses the configured stronger model

- **Telegram Bot Native** (`src/telegram/kolTelegramBotNative.ts`)
  - `handleApprove`, `handleReject`, `handleConfirmApprove`, `handleSelfConfirm`, `handleSelfReject`: on success now call `editMessageReplyMarkup` with `inline_keyboard: []` to remove buttons while preserving message text
  - On error: no edit — buttons remain visible so the user can retry
  - `handleEdit` / `handleSelfEdit` behavior unchanged

### Technical Details

- Worker command format for personality/suggestions: `agent --agent <name> --model <model> --message '...'`
- `--model` flag is injected before `--message` so the existing worker parser picks it up without changes
- Telegram keyboard removal uses standard `editMessageReplyMarkup` API call — no message text is altered

### Breaking Changes

- None — fully backward compatible; `OPENCLAW_ANALYSIS_MODEL` env var is optional with a safe default

---

## [2026-05-19] - KOL Tier System & AFK Skip Rules

### Added

- **KOL Tier System** (`src/db/models/KolProfile.ts`)
  - New field: `tier: "S" | "A" | "B" | "C"` (default: "B")
  - Tier S: Bypasses all AFK skip rules (super VIP)
  - Tier A: Skips cashtag check, applies other rules
  - Tier B: Applies all rules (default)
  - Tier C: Applies all rules (low priority)

- **KolPost Enhanced Fields** (`src/db/models/KolPost.ts`)
  - New fields: `is_retweet`, `is_quote`, `quoted_post_url`
  - Updated status enum: `"new" | "analyzed" | "pending_reply" | "replied" | "skipped"`
  - Enables granular post filtering

- **AFK Skip Rules** (`src/utils/kolPostSkipRules.ts`)
  - Pure function: `shouldSkipPost(params)` — no DB access, no side effects
  - Rule 1: Skip retweets/reposts
  - Rule 2: Skip posts with cashtags not in whitelist
  - Rule 3: Skip posts with contract addresses (EVM, Solana, Sui)
  - Rule 4: Skip posts linking to DEX/pump domains
  - Rule 5: Skip quote tweets with DEX URLs in quoted post
  - Tier S KOLs bypass all rules

- **KolSettings Cashtag Whitelist** (`src/db/models/KolSettings.ts`)
  - New field: `afk_skip_cashtag_whitelist: string[]`
  - Default: `["WIF", "BONK", "PEPE", "DOGE", "SOL", "BTC", "ETH", "BNB", "BASE", "SUI"]`
  - Configurable via `PATCH /api/kol-settings`

- **KOL API Enhancements** (`src/routes/kols.ts`)
  - `POST /api/kols` now accepts `tier` field
  - `POST /api/kols/bulk-import` supports both formats:
    - String array: `["handle1", "handle2"]` (all default to tier B)
    - Object array: `[{handle: "handle1", tier: "S"}, ...]`

- **Documentation**
  - New: `docs/kol-setup-guide.md` — comprehensive KOL setup and management guide
  - Updated: `docs/system-architecture.md` — KOL tier, skip rules, enhanced schemas
  - Updated: `docs/code-standards.md` — added kolPostSkipRules.ts to utils

### Technical Details

- Skip rules evaluated in `replyEngineService` before generating replies
- Posts matching rules marked with status: `"skipped"`
- Tier S KOLs always reply if confidence > threshold (no skip rules applied)
- Cashtag detection uses regex: `(?:^|[\s,;([\]])?\$([A-Z]{2,10})(?:[\s,;)\]]|$)`
- Contract address detection supports EVM (0x + 40 hex), Solana (32-44 base58), Sui (0x + 64 hex)

### Breaking Changes

- None — fully backward compatible

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
