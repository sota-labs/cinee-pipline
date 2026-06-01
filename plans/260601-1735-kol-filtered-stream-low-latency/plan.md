---
title: "KOL Filtered Stream — Low-Latency Post Detection"
description: "Replace polling for Tier S/A KOLs with X Filtered Stream API to reduce end-to-end latency from ~40min to <3min"
status: completed
priority: P1
effort: 10h
branch: main
tags: [feature, backend, api]
created: 2026-06-01
---

# KOL Filtered Stream — Low-Latency Post Detection

## Overview

Current polling-based crawl has up to 40min end-to-end latency (post published → reply sent). This plan adds X Filtered Stream API support for Tier S/A KOLs, reducing detection to ~5 seconds and end-to-end to <3 minutes.

Polling for Tier B/C is unchanged. Tier S/A polling intervals are relaxed (fallback only).

## Phases

| # | Phase | Status | Effort | Link |
|---|-------|--------|--------|------|
| 1 | Add stream methods to xApiClient | Completed | 1.5h | [phase-01](./phase-01-xapiclient-stream-methods.md) |
| 2 | Implement KolStreamService | Completed | 3h | [phase-02](./phase-02-kol-stream-service.md) |
| 3 | Implement kolStreamWorker script | Completed | 1.5h | [phase-03](./phase-03-kol-stream-worker.md) |
| 4 | Remove top-2 post cap in crawler | Completed | 0.5h | [phase-04](./phase-04-remove-top2-cap.md) |
| 5 | Relax Tier S/A polling intervals | Completed | 0.5h | [phase-05](./phase-05-relax-polling-intervals.md) |
| 6 | Write tests | Pending | 3h | [phase-06](./phase-06-tests.md) |

## Dependencies

- X API Basic tier credentials with Filtered Stream access (`TWITTER_BEARER_TOKEN`)
- All Tier S/A KOLs must have `x_user_id` populated (backfill via existing `getUserIdByHandle()`)
- Node.js v22 (confirmed) — `response.body` ReadableStream supported natively

## Key Files

| File | Action |
|------|--------|
| `src/services/platforms/x/xApiClient.ts` | Modify — add stream methods |
| `src/services/kolStreamService.ts` | Create |
| `src/scripts/kolStreamWorker.ts` | Create |
| `src/services/kolCrawlerService.ts` | Modify — remove top-2 cap |
| `src/db/models/KolSettings.ts` | Modify — relax default tier intervals |
| `package.json` | Modify — add `stream:kol` script |
