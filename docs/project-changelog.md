# Project Changelog

**Last Updated:** 2026-05-14

All notable changes to the cinee-pipeline project are documented here.

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
