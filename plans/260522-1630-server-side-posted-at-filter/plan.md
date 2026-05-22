# Plan: Server-side posted_at Filter for Batch Crawl Results

**Created:** 2026-05-22
**Status:** Completed

## Problem

AI agent is prompted with `sinceTimestamp` but occasionally returns posts older than that cutoff (Twitter feed is not strictly chronological, agent may scroll past the boundary). `processBatchCrawlResult` has no server-side guard — it saves every post that isn't a duplicate URL, regardless of `posted_at`. Result: stale posts (e.g. from 2025-06-07) enter the pipeline, trigger analysis, and waste suggestion quota.

## Solution

Defense-in-depth: keep the prompt instruction (best-effort) and add a hard server-side filter (guarantee).

1. Store `sinceByHandle` map in `Task.payload` when creating the batch crawl task
2. Filter posts by `posted_at > since` in `processBatchCrawlResult` using that map
3. Strengthen the prompt with an explicit IMPORTANT line
4. Webhook reads `sinceByHandle` from payload and passes it through

## Phases

| # | Phase | File(s) | Status |
|---|-------|---------|--------|
| 1 | All changes (single phase — 2 files, low risk) | `src/services/kolCrawlerService.ts`, `src/routes/tasks.ts` | Completed |

## Key Dependencies

- No schema changes — `Task.payload` is already `Record<string, unknown>`
- `processBatchCrawlResult` signature change is backward-compatible (optional param)
- `sinceByHandle` absent on legacy tasks → no filter applied (safe)

## Phase Files

- [phase-01-posted-at-filter.md](./phase-01-posted-at-filter.md)
