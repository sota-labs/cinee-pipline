---
title: KOL Crawl 2-Phase Split
status: pending
created: 2026-05-20
---

# KOL Crawl 2-Phase Split

## Problem

Single batch crawl task (tweet + comment) consistently hits 300s timeout.
Root causes: wait times too long + agent thinking overhead per comment navigation.

## Solution

Split into 2 sequential tasks:
- **Phase 1**: Tweet-only crawl with reduced wait times (~60-80s per 2 handles)
- **Phase 2**: Comment crawl triggered after Phase 1 saves posts to DB (~80-100s per 6 posts)

## Phases

| Phase | File | Status |
|-------|------|--------|
| [Phase 1: Model + Route changes](phase-01-model-route.md) | `Task.ts`, `KolPost.ts`, `kolPosts.ts` | pending |
| [Phase 2: Crawler refactor](phase-02-crawler-refactor.md) | `kolCrawlerService.ts` | pending |
| [Phase 3: Reply engine filter](phase-03-reply-engine.md) | `replyEngineService.ts` | pending |

## Key Dependencies

- Phase 1 must complete before Phase 2 (new task type + route needed)
- Phase 2 must complete before Phase 3 (comments_crawled field needed)
