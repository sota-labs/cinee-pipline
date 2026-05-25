---
status: completed
created: 2026-05-25
estimated_savings: $2.5/day direct, $3.8–4.2/day compounded
completed: 2026-05-25
---

# AI Cost Optimization Plan

Reduce KOL pipeline AI spend from ~$5.9/day to ~$3.4/day via 4 targeted optimizations.

## Phases

| # | Phase | Status | Savings | Complexity | Blocks |
|---|-------|--------|---------|------------|--------|
| 1 | [Crawl-time content filter](./phase-01-crawl-filter.md) | completed | ~$0.7/day | Low | Phase 2 |
| 2 | [Pre-reply-gen gate](./phase-02-pre-reply-gate.md) | completed | ~$0.4/day | Low | Phase 3 |
| 3 | [Merge analysis + Minimax swap](./phase-03-merge-analysis-minimax.md) | completed | ~$1.01/day | Medium | Phase 4 |
| 4 | [Prompt caching for author voice](./phase-04-prompt-caching.md) | completed (blocked) | ~$0.4/day | Medium | — |

## Execution Order

Sequential — each phase blocks the next:

```
Phase 1 → Phase 2 → Phase 3 → Phase 4
```

Phase 1 must land first: fewer posts entering pipeline = compounding savings on all downstream phases.

## Key Files

- `src/services/kolCrawlerService.ts` — Phase 1
- `src/services/replyEngineService.ts` — Phase 2, Phase 4
- `src/services/kolAnalyzerService.ts` — Phase 3
- `src/prompts/kolPrompts.ts` — Phase 3, Phase 4
- `src/config/settings.ts` — Phase 3

## Dependencies

- Phase 2 uses `is_spam` + `quality_score` fields that Phase 3 adds to merged analysis output — but Phase 2 only gates on them if present (null-safe). Phase 2 can ship before Phase 3 safely.
- Phase 4 requires verifying OpenRouter `cache_control` support before implementation.

## Success Metrics

- Daily AI cost < $3.5
- Retweet save rate = 0% (currently 53%)
- Reply quality (confidence score distribution) unchanged
- Posts dropped at crawl logged and monitorable
