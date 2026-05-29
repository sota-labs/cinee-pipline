---
status: pending
spec: plans/260529-1500-x-api-hybrid-platform-architecture/spec.md
---

# X API Hybrid Migration Plan

Replace KOL post crawling with X API v2 direct calls. Post/reply stays on browser automation.
New code lives under `src/services/platforms/x/` — structured for future platform expansion.

## Phases

| # | Phase | Status | Owner |
|---|-------|--------|-------|
| 1 | [Config & Model](./phase-01-config-and-model.md) | pending | — |
| 2 | [X API Client](./phase-02-x-api-client.md) | pending | — |
| 3 | [Result Mapper](./phase-03-result-mapper.md) | pending | — |
| 4 | [Crawler Integration](./phase-04-crawler-integration.md) | pending | — |
| 5 | [Tests](./phase-05-tests.md) | pending | — |

## Execution Order

Phases 1 → 2 → 3 → 4 → 5 (sequential — each phase depends on the previous).

## Key Dependencies

- Phase 1 must complete before Phase 2 (settings.ts token + KolProfile.x_user_id needed)
- Phase 2 must complete before Phase 3 (XApiTweet types defined in xApiClient.ts)
- Phase 3 must complete before Phase 4 (mapper functions needed in crawler)
- Phase 4 must complete before Phase 5 (integration test targets crawlKol())

## Files Changed

- `src/config/settings.ts` — add X_API_BEARER_TOKEN
- `src/db/models/KolProfile.ts` — add x_user_id field
- `src/services/platforms/x/xApiClient.ts` — NEW
- `src/services/platforms/x/xResultMapper.ts` — NEW
- `src/services/kolCrawlerService.ts` — replace browser task calls with API calls
- `src/tests/xResultMapper.test.ts` — NEW
- `src/tests/xApiClient.test.ts` — NEW
- `src/tests/kolCrawlerIntegration.test.ts` — NEW
- `.env.example` — add X_API_BEARER_TOKEN entry

## Unchanged

- Task queue, cinee-worker, OpenClaw browser automation
- Post/reply flow (replyEngineService, selfReplyService)
- processCrawlResults() — called with mapped results, signature unchanged
- All downstream: analysis, suggestions, AFK/manual, Telegram
