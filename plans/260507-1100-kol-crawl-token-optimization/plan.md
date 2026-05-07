---
title: "KOL Crawl Token Optimization via JS Injection"
description: "Replace verbose LLM crawl prompts with minimal prompts embedding static JS scripts for ~90% token reduction"
status: pending
priority: P1
effort: 6h
branch: main
tags: [kol, crawl, optimization, token-reduction, openclaw]
created: 2026-05-07
---

# KOL Crawl Token Optimization

## Problem

KOL crawl tasks use verbose LLM prompts (~180 lines, ~3000-5000 tokens) that instruct OpenClaw to reason through each DOM extraction step. This causes token waste and 300s execution timeouts for 2+ KOLs.

## Solution

Replace verbose natural-language prompts with minimal (~15 line) prompts that embed static JavaScript extraction scripts. OpenClaw navigates to Twitter/X, runs `page.evaluate(script)`, returns structured JSON. BE parses and saves.

**Impact:** ~90% token reduction, execution time 300s+ -> ~40s for 5 KOLs.

## Phases

| # | Phase | Effort | Status | File |
|---|-------|--------|--------|------|
| 1 | Create static JS extraction scripts | 1h | pending | [phase-01](./phase-01-create-extraction-scripts.md) |
| 2 | Create result parser/validator | 1.5h | pending | [phase-02](./phase-02-create-result-parser.md) |
| 3 | Modify kolCrawlerService prompts + add processBatchCrawlResult | 2h | pending | [phase-03](./phase-03-modify-crawler-service.md) |
| 4 | Add POST /:id/process-result endpoint | 0.5h | pending | [phase-04](./phase-04-add-process-result-endpoint.md) |
| 5 | Write unit tests | 1h | pending | [phase-05](./phase-05-write-tests.md) |

## Dependencies

- Phase 2 depends on Phase 1 (parser imports script types)
- Phase 3 depends on Phases 1 + 2 (service uses scripts + parser)
- Phase 4 depends on Phase 3 (endpoint calls processBatchCrawlResult)
- Phase 5 can start after Phase 2 (parser tests), full suite after Phase 4

## Key Decisions

1. **No model/schema changes** -- KolPost, Task, KolProfile models untouched
2. **No worker changes** -- worker.js on Machine B unchanged
3. **Idempotent endpoint** -- `post_url` unique index handles dedup on re-process
4. **Reuse `extractResponse()`** -- existing delimiter extraction logic works as-is
5. **Export `IRawPost` to parser** -- move interface to shared location, re-export from service

## Files Changed

| File | Action |
|------|--------|
| `src/utils/kolCrawlScript.ts` | NEW |
| `src/utils/kolCrawlResultParser.ts` | NEW |
| `src/services/kolCrawlerService.ts` | MODIFY |
| `src/routes/tasks.ts` | MODIFY |
| `src/tests/kolCrawlResultParser.test.ts` | NEW |
| `src/tests/kolCrawlScript.test.ts` | NEW |

## Success Metrics

| Metric | Before | Target |
|--------|--------|--------|
| Prompt token count (batch 2 KOLs) | ~3000-5000 | < 600 |
| Task execution time (2 KOLs) | 300s (timeout) | < 60s |
| task.prompt field size | ~4KB | < 800 bytes |

## Risks

| Risk | Mitigation |
|------|-----------|
| Twitter changes `data-testid` selectors | Centralized in `kolCrawlScript.ts`, single-file update |
| OpenClaw `page.evaluate` syntax differences | Test with simple script first |
| Lazy-loaded tweets missed | 3x scroll with 2s delay covers most timelines |
