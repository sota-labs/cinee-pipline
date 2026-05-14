# Project Roadmap

**Last Updated:** 2026-05-14

## Current State

The cinee-pipeline has completed core personality learning and self-reply generation for the CEO's own account. KOL engagement system is in active development with crawling, analysis, and AFK/Manual reply modes operational.

## Short-term (Next 1-3 Months)

- **KOL Engagement Refinement** — Improve personality learning accuracy and reply quality
- **Safety & Rate Limiting** — Enhance duplicate detection and hourly reply limits
- **Manual Review Workflow** — Streamline Telegram notifications and approval process
- **Reputation Scoring** — Refine KOL reputation calculation and caching
- **Performance Optimization** — Optimize Redis caching and MongoDB queries

## Medium-term (3-6 Months)

- **Content Creation Pipeline** — Research → Draft → Review → Publish workflow
- **Multi-Platform Support** — Extend beyond X to other social platforms
- **Advanced Analytics** — Engagement metrics, ROI tracking, trend analysis
- **Webhook Reliability** — Implement retry logic and dead-letter queues
- **Admin Dashboard** — Web UI for monitoring and configuration

## Long-term Vision

- **Autonomous Content Strategy** — AI-driven content planning and scheduling
- **Community Building** — Automated community engagement and relationship tracking
- **Influencer Network** — Expand KOL tracking to ecosystem partners
- **Real-time Adaptation** — Dynamic personality adjustment based on engagement
- **Multi-agent Orchestration** — Coordinate multiple AI agents for complex tasks

## Technical Debt

- Refactor large service files (>200 LOC) into smaller modules
- Add comprehensive integration tests for webhook flows
- Improve error handling and logging consistency
- Document all API response formats
- Add rate limiting middleware to all routes

## Dependencies & Blockers

None currently. All core systems operational.
