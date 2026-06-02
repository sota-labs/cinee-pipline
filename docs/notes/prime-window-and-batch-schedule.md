# KOL Crawl Schedule: Prime Window + OpenClaw Batch

**Status:** Active since 2026-06-02
**Replaces:** X Filtered Stream worker (Pro tier) + `crawlDueKols` (B/C polling)

## Why we dropped the X Filtered Stream

The previous architecture used Twitter's Filtered Stream endpoint
(`/tweets/search/stream`) for real-time Tier S/A post capture. This endpoint
is gated to **X API Pro ($5k/month)**. Our project is on the **Pay-Per-Use**
tier, which bills per-call but does **not** include the Filtered Stream endpoint.
Twitter returns `503 Service Unavailable` for stream calls on lower tiers
(not 403 — they don't say "you can't access this" explicitly).

Upgrading to Pro was not justified by post volume. We replaced the stream
with a hybrid schedule that uses Pay-Per-Use quota efficiently and falls
back to OpenClaw browser automation for the rest.

## Schedule (server-local time; production = UTC)

| Cron | Tiers | Path | Latency |
|------|-------|------|---------|
| `*/15 * * * *` | S (only inside `prime_window`) | X API direct polling | ~15 min |
| `0 */2 * * *` | S (off-prime) + A | OpenClaw batch task | up to 2h |
| `0 */3 * * *` | B | OpenClaw batch task | up to 3h |
| `0 */4 * * *` | C | OpenClaw batch task | up to 4h |

Default `prime_window`: `09:00-13:00` UTC. Override via `KolSettings.prime_window`
or `PATCH /api/kol-settings`.

Default per-tier batch intervals (minutes): A=120, B=180, C=240. Override via
`KolSettings.tier_batch_intervals`.

## Why prime window for Tier S

Tier S KOLs are the highest-value and most-active accounts. We trade quota
for latency during a 4h "prime" window when KOLs are most likely to post:

- **Inside the window**: `getUserTweets` is called every 15 min per Tier S KOL.
  With ~25 Tier S KOLs × 16 calls/day = 400 calls/day on the user-timeline
  endpoint. Comfortably under Pay-Per-Use limits.
- **Outside the window**: an OpenClaw batch task runs every 2h. Latency is
  higher, but Pay-Per-Use quota is preserved for the prime window.

This is the right cost-quality trade: low latency when it matters most,
cheap when it doesn't.

## Why batch for everyone else

OpenClaw uses browser automation, not the X API, so it doesn't burn Pay-Per-Use
quota. The trade is wall-clock time (a batch takes minutes per KOL) and
cinee-worker compute. For Tier A/B/C, where post volume is lower and the
value of low-latency capture is reduced, this trade is acceptable.

Batch interval scales with tier:
- **A (high-value, but lower than S)**: every 2h
- **B (mid-tier)**: every 3h
- **C (low-tier)**: every 4h

The end-to-end batch path is the same one the project used before the
filtered stream was added — `processBatchCrawlResult` (in
`kolCrawlerService.ts`) processes results returned by cinee-worker via the
`/api/tasks/:id/complete` webhook.

## How to configure

```bash
# Run after deploying the schema change
npm run migrate:kol-settings-prime-window
```

To change the prime window for a Tier-S-heavy region (e.g. APAC):

```bash
curl -X PATCH http://localhost:3000/api/kol-settings \
  -H "Content-Type: application/json" \
  -d '{"prime_window": {"start_hour": 2, "end_hour": 6}}'
# 02:00-06:00 UTC = 09:00-13:00 ICT
```

To change per-tier batch intervals (in minutes):

```bash
curl -X PATCH http://localhost:3000/api/kol-settings \
  -H "Content-Type: application/json" \
  -d '{"tier_batch_intervals": {"A": 60, "B": 180, "C": 360}}'
```

## Architecture

```
kolDaemon (node-cron)
  ├─ */15 * * * *   → tickPrimePolling() → runPrimePolling()
  │                                       ├─ if !isWithinPrimeWindow → return
  │                                       └─ KolProfile.find({tier:"S"}) → kolCrawlerService.crawlKol
  ├─ 0  */2 * * *   → tickBatchCrawl(["S","A"]) → runBatchCrawl → createBatchCrawlTasks → Task.create
  ├─ 0  */3 * * *   → tickBatchCrawl(["B"])     → runBatchCrawl → createBatchCrawlTasks → Task.create
  └─ 0  */4 * * *   → tickBatchCrawl(["C"])     → runBatchCrawl → createBatchCrawlTasks → Task.create

cinee-worker (separate repo)
  └─ picks up Task, runs browser agent, posts result back to /api/tasks/:id/complete
    └─ webhook routes/tasks.ts:296-310 detects action="batch_crawl"
      └─ processBatchCrawlResult → KolPost.create (deduped by post_url)
```

`kolScheduleService` holds the mutexes (`isPrimePolling`, `isBatchCrawling`)
and exposes `runPrimePolling` / `runBatchCrawl` for testability. `kolDaemon`
is a thin wrapper that wires the functions to cron schedules.

## Open questions / follow-ups

1. **Timezone** — `prime_window` is stored in server-local hours. If production
   moves to a different timezone, all configs need to be updated. Consider
   storing the IANA timezone string explicitly in a future iteration.
2. **Multi-instance deployments** — the mutexes are in-process booleans. Two
   daemon instances would double-fire. A Redis-based lock (e.g. `redlock`) is
   the standard fix; out of scope for this refactor.
3. **Stale OpenClaw tasks** — if cinee-worker is down, tasks accumulate. The
   existing 2h `MAX_CRAWL_WINDOW_MS` guard + `post_url` dedup drops duplicates
   on retry, so wasted OpenClaw compute is the worst case.
4. **Prime window quota** — if Tier S KOL count grows past ~50, the 15-min
   cadence × 50 KOLs = 200 calls/15min may approach Pay-Per-Use rate limits.
   Monitor X API usage; consider increasing the interval or shortening the
   prime window.
