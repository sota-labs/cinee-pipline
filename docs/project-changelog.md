# Project Changelog

**Last Updated:** 2026-06-03

All notable changes to the cinee-pipeline project are documented here.

---

## [2026-06-03] - Tier S Batch Crawl: Split to 1h Cron, Skip During Prime Window

### Changed

- **KOL Daemon cron split** (`src/scripts/kolDaemon.ts`)
  - Tier S batch crawl separated from Tier A into its own `0 */1 * * *` cron (every 1h)
  - Tier A remains on `0 */2 * * *` (every 2h)
  - Added `isAutoRejectRunning` mutex guard to `executeAutoReject` (runs every 10min, was unguarded)
  - Fixed `executeSessionCleanup` task fields: `agent: "" → "system"`, `prompt: "" → "session_cleanup"`

- **`runBatchCrawl` prime window gate** (`src/services/kolScheduleService.ts`)
  - Tier S is now skipped when `isWithinPrimeWindow()` is true — X API prime polling already covers it
  - Mutex keyed on original `tiers` argument (before S is filtered out) for correct lock semantics

- **Tier S batch cutoff** (`src/services/kolCrawlerService.ts`)
  - `createBatchCrawlTasks` Tier S cutoff changed from 120min → 60min to match the new 1h cron
  - `updateKolStats` now sorts posts by `posted_at DESC` before applying `limit(200)`, ensuring averages reflect the 200 most recent posts

---

## [2026-06-02] - Refactor: Drop X Filtered Stream, Add Prime Window + OpenClaw Batch Schedule

### Removed

- **X Filtered Stream worker** — `src/scripts/kolStreamWorker.ts`, `src/services/kolStreamService.ts`, `src/services/platforms/x/xStreamTypes.ts`. The Pay-Per-Use tier does not include Filtered Stream access (returns 503); Pro tier not justified by post volume.
- **`crawlDueKols` + `ICrawlSpawnResult`** from `kolCrawlerService.ts` — replaced by `createBatchCrawlTasks` factory.
- **Script `stream:kol`** from `package.json`.
- **Stream re-exports** from `xApiClient.ts`.

### Added

- **Prime window** (configurable in `KolSettings.prime_window`, default `09:00-13:00` UTC) — Tier S KOLs are polled via X API every 15 min inside the window.
- **OpenClaw batch tasks** for all tiers outside the prime window — factory `createBatchCrawlTasks(tiers, options?)` in `kolCrawlerService.ts` creates one Task record per KOL (with `handle_group` and `payload.action === "batch_crawl"`). cinee-worker handles the rest via the existing webhook path.
- **`kolScheduleService`** — extracted `runPrimePolling` and `runBatchCrawl` for testability. Mutexes (`isPrimePolling`, `isBatchCrawling`) prevent overlapping runs.
- **Schema additions** to `KolSettings`: `prime_window: { start_hour, end_hour }` and `tier_batch_intervals: { A, B, C }` (in minutes).
- **Migration script** `migrate:kol-settings-prime-window` — idempotent backfill of new fields.
- **Tests** in `src/tests/kolScheduleService.test.ts` — 10 tests covering `isWithinPrimeWindow`, KolSettings defaults, `runPrimePolling` (in/out of window), `runBatchCrawl`, mutex behavior.

### Changed

- **`kolDaemon.ts`** — replaced single `executeTierCrawl` cron with 4 jobs (`*/15`, `0 */2`, `0 */3`, `0 */4`); wrapped in `tickPrimePolling` / `tickBatchCrawl` helpers; removed inline mutexes (moved to `kolScheduleService`).
- **`tier_crawl_intervals.S`** default lowered from 120 → 15 min (used as the prime-window X API poll interval).
- **`PATCH /api/kol-settings`** — accepts `prime_window` and `tier_batch_intervals` with validation.
- **Route** exposes the new fields in `GET /api/kol-settings` response.

### Migration

After deploying:
```bash
npm run migrate:kol-settings-prime-window
```

See `docs/notes/prime-window-and-batch-schedule.md` for the full rationale.

---

## [2026-05-25] - AI Cost Optimization: Crawl Filter, Reply Gate, Merged Analysis, Minimax Swap

### Added

- **Crawl-time Content Filter** (`src/services/kolCrawlerService.ts`)
  - New function: `shouldDropAtCrawl()` filters low-value posts before DB insertion
  - Drops retweets, posts < 15 chars, quote posts < 30 chars
  - New field: `dropped` count in `ICrawlResult` interface
  - Estimated savings: ~$0.7/day

- **Pre-reply-gen Gate** (`src/services/replyEngineService.ts`)
  - New function: `passesReplyGate()` checks virality, spam, quality before Sonnet task creation
  - Gates on: `virality_score < 30`, `is_spam === true`, `quality_score < 40`
  - Skipped posts marked with status `SKIPPED`
  - Estimated savings: ~$0.4/day

- **Merged Analysis Prompt** (`src/prompts/kolPrompts.ts`)
  - New constant: `MERGED_ANALYSIS_PROMPT` combines post analysis + comment pattern analysis
  - New function: `buildMergedAnalysisPrompt()` for single-pass analysis
  - Reduces 2 analysis tasks per post to 1

- **Minimax Model Swap** (`src/config/settings.ts`, `src/services/kolAnalyzerService.ts`)
  - `openClawAnalysisModel` default changed to `openrouter/minimax/minimax-m2.5`
  - `queuePostAnalysis()` now creates 1 merged task instead of 2
  - Estimated savings: ~$1.01/day

### Modified

- **KOL Post Model** (`src/db/models/KolPost.ts`)
  - `analysis` subdocument: added `is_spam: Boolean` and `quality_score: Number` fields
  - Updated `IAnalysisResult` interface: added `isSpam` and `qualityScore` fields

- **KOL Analyzer Service** (`src/services/kolAnalyzerService.ts`)
  - `processPostAnalysisResult()` now returns `isSpam` and `qualityScore`
  - `applyAnalysisResults()` stores `is_spam` and `quality_score` on post.analysis
  - `queuePostAnalysis()` creates single merged task with Minimax model

- **KOL Crawler Service** (`src/services/kolCrawlerService.ts`)
  - `processCrawlResults()` filters posts via `shouldDropAtCrawl()` before insertion
  - Returns `dropped` count in result object
  - `processBatchCrawlResult()` logs dropped count per handle

### Technical Details

- Total estimated savings: ~$2.5/day direct, ~$3.8–4.2/day compounded
- Phase 1 (crawl filter) reduces posts entering pipeline, compounding savings on downstream phases
- Phase 2 (reply gate) uses `is_spam`/`quality_score` fields populated by Phase 3 (null-safe until Phase 3 lands)
- Phase 4 (prompt caching) documented as blocked — OpenClaw CLI uses flat `--message` string which doesn't support `cache_control` structured messages

### Breaking Changes

- None — all changes are additive or internal optimizations

---

## [2026-05-22] - Task Priority System & Handle-Aware Task Selection

### Added

- **Task Priority System** (`src/utils/taskPriority.ts`)
  - New utility: `tierToPriority(tier: string): number`
  - Maps KOL tier to priority: S=40, A=30, B=20, C=10
  - Enables priority-based task execution for KOL-specific work

- **Task Model Enhancements** (`src/db/models/Task.ts`)
  - New field: `priority: number` (default: 0)
  - New field: `handle_group?: string | null` (default: null)
  - Compound index: `{ status: 1, priority: -1, created_at: 1 }` for efficient priority-based queries
  - Non-KOL tasks have priority=0; KOL tasks inherit tier-based priority

- **Handle-Aware Task Selection API** (`src/routes/tasks.ts`)
  - New endpoint: `GET /api/tasks/next-pending`
  - Returns next pending task sorted by: status → priority (descending) → created_at
  - Filters by `handle_group` if provided in query params
  - Enables worker to select high-priority KOL tasks first

### Modified

- **KOL Crawler Service** (`src/services/kolCrawlerService.ts`)
  - `queueCrawlTask()` now propagates `priority` and `handle_group` to Task records
  - Priority derived from KOL tier via `tierToPriority()`

- **KOL Analyzer Service** (`src/services/kolAnalyzerService.ts`)
  - `queueAnalysisTask()` now propagates `priority` and `handle_group` to Task records
  - Analysis tasks inherit KOL tier-based priority

- **Reply Engine Service** (`src/services/replyEngineService.ts`)
  - `queueReplyTask()` now propagates `priority` and `handle_group` to Task records
  - Reply tasks inherit KOL tier-based priority

- **Worker Task Selection** (`worker/worker.js`)
  - Updated to use `GET /api/tasks/next-pending` instead of `GET /api/tasks?status=pending`
  - Worker now respects task priority and handle_group for intelligent task selection

### Technical Details

- Priority system enables Tier S KOLs to have their tasks executed first (priority 40)
- Handle-aware selection allows workers to focus on specific KOL groups if needed
- Backward compatible: existing tasks without priority/handle_group default to 0/null
- Compound index optimizes query performance for high-volume task queues

### Breaking Changes

- None — fully backward compatible; priority and handle_group are optional fields with safe defaults

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
