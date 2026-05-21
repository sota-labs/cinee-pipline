---
title: "Stronger Model for Slang/Reply + Telegram Keyboard Fix"
description: "Use a stronger AI model for personality learning and reply suggestion tasks; remove inline keyboard on Telegram success without altering message text."
status: completed
priority: P2
effort: 1.5h
issue:
branch: main
tags: [backend, feature]
created: 2026-05-21
---

# Stronger Model for Slang/Reply + Telegram Keyboard Fix

## Overview

Two independent improvements:
1. Inject `--model` flag for `personality` (learn slang) and `generate_suggestions` tasks so they use a stronger model (configurable via env var).
2. On Telegram approve/reject success: remove inline keyboard buttons without changing message text. On error: keep buttons intact.

## Phases

| # | Phase | Status | Effort | Link |
|---|-------|--------|--------|------|
| 1 | Add `openClawAnalysisModel` to settings + inject into tasks | Completed | 45m | [phase-01](./phase-01-model-override.md) |
| 2 | Telegram keyboard removal on success | Completed | 45m | [phase-02-telegram-keyboard.md](./phase-02-telegram-keyboard.md) |

## Dependencies

- Phase 1 and Phase 2 are independent — can be done in any order.
- No DB migrations required.
- No worker changes required.
