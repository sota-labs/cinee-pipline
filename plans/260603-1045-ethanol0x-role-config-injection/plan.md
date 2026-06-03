---
status: completed
progress: 100%
spec: reports/spec.md
---

# Plan: @ethanol0x Role Config Injection

**Goal:** Connect `slang/bot_reply_system_prompt_EN.md` to the reply pipeline via a `RoleConfig` JSON file, and add code-level AFK semantic blacklist to skip unsafe posts before LLM cost is incurred.

**Scope:** 3 files touched, no new services, no DB changes.

## Phases

| # | Phase | Status | File |
|---|-------|--------|------|
| 1 | Add semantic blacklist to skip rules | completed | [phase-01](phase-01-semantic-blacklist.md) |
| 2 | Create ethanol0x RoleConfig JSON | completed | [phase-02](phase-02-ethanol0x-role-config.md) |
| 3 | Wire semantic check in replyEngineService | completed | [phase-03](phase-03-wire-semantic-check.md) |
| 4 | Unit tests | completed | [phase-04](phase-04-tests.md) |

## Key Dependencies

- Phase 3 depends on Phase 1 (imports `shouldSkipBySemantics`)
- Phase 4 depends on Phases 1–3
- Phase 2 is independent — can be done in parallel with Phases 1+3
