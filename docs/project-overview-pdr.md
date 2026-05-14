# Project Overview & Product Development Requirements

**Last Updated:** 2026-05-14

## Project Purpose

cinee-pipeline is a CEO automation system that learns the founder's authentic writing style and generates AI-powered content, replies, and engagement across social media platforms. It integrates with OpenClaw for browser automation and uses MongoDB for data persistence.

## Target Users

- **Primary:** CEO/Founder of Cinee (AI filmmaking platform)
- **Secondary:** Admin users managing content and engagement workflows

## Core Features

| Feature | Description |
|---------|-------------|
| **Own Account Personality Learning** | Analyzes CEO's past tweets to extract writing style, tone, and personality traits |
| **Self-Reply AI Generation** | Generates authentic replies to comments on CEO's own posts using learned personality |
| **KOL Crawling & Analysis** | Crawls posts from tracked Key Opinion Leaders and analyzes their content |
| **KOL Personality Learning** | Learns personality profiles of KOLs for targeted engagement |
| **Dynamic Topic Configuration** | Switch between different domains/personas via TopicConfig |
| **Content Review Pipeline** | Review and approve AI-generated content before publishing |
| **Scheduler & Cron Jobs** | Automated task scheduling for content creation and engagement |
| **Priority Account Monitoring** | Track high-value accounts for engagement opportunities |
| **Reputation Tracking** | Monitor KOL reputation scores and engagement metrics |

## Non-Functional Requirements

| Requirement | Details |
|-------------|---------|
| **Performance** | Async/await for all I/O; connection pooling for MongoDB/Redis |
| **Reliability** | Task queue prevents blocking; graceful error handling with retry logic |
| **Security** | Input validation; environment-based secrets; webhook signature verification |
| **Scalability** | Horizontal scaling via task queue; Redis caching for frequently accessed data |
| **Maintainability** | TypeScript strict typing; modular service layer; comprehensive logging |

## External Dependencies

| Dependency | Purpose |
|------------|---------|
| **OpenClaw** | Browser automation engine for executing CLI commands |
| **MongoDB** | Primary data store for all models and task queue |
| **Redis** | Session caching, rate limiting, and temporary state |
| **Telegram** | Notification channel for manual review workflows |
| **X (Twitter)** | Social media platform for content posting and engagement |

## Key Constraints

- OpenClaw integration is async via task queue (no direct CLI execution)
- All prompts must be dynamically built from RoleConfig (no hardcoded personas)
- Human-like writing rules injected into all content prompts
- Node16 module resolution with .js extensions for imports
- Strong TypeScript typing (no `any` types)

## Success Metrics

- CEO personality learning accuracy (posts_analyzed, learning_confidence)
- Self-reply generation quality and engagement rates
- KOL engagement effectiveness (reputation scores, interaction counts)
- System uptime and task completion rates
- Content review turnaround time
