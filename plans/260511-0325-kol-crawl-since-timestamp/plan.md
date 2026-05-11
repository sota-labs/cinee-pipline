---
status: completed
created: 2026-05-11
spec: ./spec.md
---

# Plan: KOL Crawl Since-Timestamp Filtering

## Goal

Pass per-handle `sinceTimestamp` from Redis cache down to the browser-level DOM script so each crawl only fetches posts newer than the last crawl, capped at 24h max window.

## Phases

| # | Phase | Files | Status |
|---|-------|-------|--------|
| 1 | Update `KOL_TWEET_SCRIPT` to accept `sinceTimestamp` | `src/utils/kolCrawlScript.ts` | completed |
| 2 | Update crawl service: cap logic + prompt format | `src/services/kolCrawlerService.ts` | completed |

## Key Rule

```
effectiveSince = max(cachedSince ?? db.last_crawled_at ?? null, now - 24h)
```

- `null` → defaults to `now - 24h`
- older than 24h → capped to `now - 24h`
- recent → kept as-is

## Dependencies

- Phase 2 depends on Phase 1 (prompt must reference the new script calling convention)
- No external library changes needed
- No DB schema changes needed
- No Redis key/TTL changes needed
