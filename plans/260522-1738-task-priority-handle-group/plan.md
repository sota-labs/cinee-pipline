---
title: "Task Priority + Handle Group Flow Isolation"
description: "Add priority field and handle_group to Task model; worker picks tasks by active handle to ensure full KOL flow completes before switching handles."
status: pending
priority: P1
effort: 3h
tags: [backend, database, feature]
created: 2026-05-22
---

# Task Priority + Handle Group Flow Isolation

## Overview

Thêm `priority` và `handle_group` vào Task model. Worker dùng endpoint mới `GET /api/tasks/next-pending` để pick task theo logic: nếu có handle đang processing → tiếp tục handle đó; nếu không → pick task priority cao nhất. Đảm bảo flow `batch_crawl → comment_crawl → analyze → suggest_reply` của một handle hoàn chỉnh trước khi chuyển sang handle khác.

## Spec

[spec-260522-task-priority-handle-group.md](../reports/spec-260522-task-priority-handle-group.md)

## Phases

| # | Phase | Status | Effort | Link |
|---|-------|--------|--------|------|
| 1 | Task model + priority helper | Pending | 30m | [phase-01](./phase-01-task-model.md) |
| 2 | Propagate priority/handle_group vào services | Pending | 1h | [phase-02-services.md](./phase-02-services.md) |
| 3 | API endpoint next-pending + webhook propagation | Pending | 45m | [phase-03-api.md](./phase-03-api.md) |
| 4 | Worker — dùng next-pending endpoint | Pending | 15m | [phase-04-worker.md](./phase-04-worker.md) |

## Dependencies

- Không có schema migration cần thiết — MongoDB schemaless, field mới tự thêm
- `crawl_handles_per_task = 1` trong KolSettings để flow isolation hoạt động đầy đủ ở phase 1
- Worker (`cinee-worker`) và pipeline (`cinee-pipline`) deploy cùng lúc
