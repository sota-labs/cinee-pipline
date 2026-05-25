# Development Roadmap

**Last Updated:** 2026-05-25

## Overview

This document tracks the project phases, milestones, and progress for the cinee-pipeline CEO automation system.

---

## Completed Features

### AI Cost Optimization Initiative
**Status:** Complete (2026-05-25)
**Estimated Savings:** ~$2.5/day direct, ~$3.8–4.2/day compounded

Multi-phase optimization reducing KOL pipeline AI spend from ~$5.9/day to ~$3.4/day.

**Phases Completed:**
1. **Crawl-time Content Filter** — Drop retweets and short posts before DB insertion (~$0.7/day savings)
2. **Pre-reply-gen Gate** — Check virality, spam, quality before Sonnet task creation (~$0.4/day savings)
3. **Merged Analysis + Minimax Swap** — Single analysis task per post using cheaper Minimax model (~$1.01/day savings)
4. **Prompt Caching** — Documented as blocked (OpenClaw CLI limitation; requires structured message support)

**Key Components:**
- `shouldDropAtCrawl()` filter in `kolCrawlerService`
- `passesReplyGate()` gate in `replyEngineService`
- `MERGED_ANALYSIS_PROMPT` and `buildMergedAnalysisPrompt()` in `kolPrompts`
- Minimax model integration in `kolAnalyzerService`
- `is_spam` and `quality_score` fields added to KolPost analysis subdocument

### Own Account Post Seeding for AI Learning
**Status:** Complete (2026-05-18)
**Branch:** chore/improve-kol-crawl

System to crawl and seed the CEO's own account posts into the database for AI personality learning. Posts are fetched from X/Twitter and stored with status POSTED, ready for the daily personality learning cron to analyze.

**Key Components:**
- `ownAccountCrawlerService` for queuing crawl tasks and processing results
- `seedOwnAccountPostsCron.ts` script for on-demand post seeding
- API endpoints for queuing crawls and receiving results
- Deduplication by post_url to prevent duplicate seeding
- Configurable date range (daysBack) and post limit

### Own Account Personality Learning + Self-Reply AI Integration
**Status:** Complete (2026-05-14)
**Branch:** chore/improve-kol-crawl

The system learns the CEO's own writing style from their posted tweets and uses that learned personality to generate authentic AI replies to comments on their own posts.

**Key Components:**
- `OwnAccountProfile` model for storing manual config, learned profile, and effective profile
- Daily learning cron job (03:00 AM) that analyzes own tweets
- Self-reply generation service that applies learned personality
- API routes for managing account personality settings
- Webhook integration for task completion handling

### KOL Crawl → Analyze → Reply System
**Status:** Complete (2026-05-14)
**Branch:** chore/improve-kol-crawl

Comprehensive system for tracking Key Opinion Leaders, learning their personalities, and generating targeted replies.

**Key Components:**
- `KolProfile`, `KolPost`, `KolReplySuggestion`, `KolReputationCache` models
- `KolSettings` for global engagement configuration (AFK/Manual modes)
- KOL crawl cron (every 30 min) for fetching posts
- KOL analyze cron (every 60 min) for personality learning
- AFK auto-reply mode with confidence thresholds and rate limiting
- Manual review mode with Telegram notifications
- Reputation scoring and caching system

### Content Review Pipeline
**Status:** Complete (2026-05-14)

System for reviewing and approving AI-generated content before publishing.

**Key Components:**
- Content review routes and services
- Task queue integration for async processing
- Webhook callbacks for completion handling

### Scheduler & Cron Job System
**Status:** Complete (2026-05-14)

Flexible task scheduling system with support for multiple cron jobs.

**Key Components:**
- Task model for async job queue
- Scheduler service for task management
- Multiple cron job scripts (crawl, analyze, reply, learn, etc.)
- npm scripts for adding/removing jobs dynamically

### Dynamic Topic Configuration
**Status:** Complete (2026-05-14)

Switch between different domains/personas without code changes.

**Key Components:**
- `TopicConfig` model for storing domain configurations
- API routes for activating/deactivating topics
- Fallback to settings.ts default when no topic active

### Priority Account Monitoring
**Status:** Complete (2026-05-14)

Track high-value accounts for engagement opportunities.

**Key Components:**
- `PriorityAccount` model
- Priority account service and routes
- Integration with KOL engagement system

---

## In Progress

(None currently)

---

## Planned Features

### Content Creation Pipeline
- Research → Draft → Review → Publish workflow
- Automated content generation based on trending topics
- Multi-platform content adaptation

### Advanced Analytics
- Engagement metrics and ROI tracking
- Trend analysis and opportunity detection
- Performance dashboards

### Multi-Platform Support
- Extend beyond X to LinkedIn, Reddit, Discord
- Platform-specific personality adaptation
- Cross-platform engagement coordination

### Admin Dashboard
- Web UI for monitoring and configuration
- Real-time task status tracking
- Analytics visualization

---

## Milestones

| Milestone | Target Date | Status |
|-----------|-------------|--------|
| Own Account Post Seeding | 2026-05-18 | Complete |
| Own Account Personality Learning | 2026-05-14 | Complete |
| Self-Reply AI Integration | 2026-05-14 | Complete |
| KOL Crawl & Analysis System | 2026-05-14 | Complete |
| KOL AFK/Manual Reply Modes | 2026-05-14 | Complete |
| Content Review Pipeline | 2026-05-14 | Complete |
| Scheduler & Cron System | 2026-05-14 | Complete |
| Dynamic Topic Configuration | 2026-05-14 | Complete |
| Priority Account Monitoring | 2026-05-14 | Complete |

---

## Dependencies & Blockers

(None currently)
