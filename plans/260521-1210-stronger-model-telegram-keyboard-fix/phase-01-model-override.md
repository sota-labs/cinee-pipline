# Phase 01 — Add `openClawAnalysisModel` + Inject into Tasks

## Context Links

- `src/config/settings.ts` — Settings interface and defaults
- `src/services/kolAnalyzerService.ts` — `queueAnalysisTask()`, `learnPersonality()`
- `src/services/replyEngineService.ts` — `generateSuggestions()`

## Overview

- **Priority:** P2
- **Status:** Completed
- **Description:** Add a new env-driven setting `openClawAnalysisModel` and inject it as `--model` flag only for `personality` and `generate_suggestions` tasks. All other tasks unchanged.

## Key Insights

- Worker parses `task.prompt` by splitting at `" --message "`. Everything before becomes CLI flags. So `--model` injected before `--message` is automatically picked up — no worker changes needed.
- `queueAnalysisTask()` currently builds: `agent --agent main --message '...'`
- Target: `agent --agent main --model <model> --message '...'` for personality tasks only
- `replyEngineService.ts` builds its own command inline (not via `queueAnalysisTask`) — needs separate change.

## Requirements

- New env var: `OPENCLAW_ANALYSIS_MODEL` (default: `"openrouter/anthropic/claude-sonnet-4.6"`)
- `personality` tasks use `openClawAnalysisModel`
- `generate_suggestions` tasks use `openClawAnalysisModel`
- `post_analysis`, `comment_pattern`, crawl tasks — unchanged (no `--model` flag)

## Related Code Files

- **Modify:** `/home/sotatek/Documents/cinee-openclaw/cinee-pipline/src/config/settings.ts`
- **Modify:** `/home/sotatek/Documents/cinee-openclaw/cinee-pipline/src/services/kolAnalyzerService.ts`
- **Modify:** `/home/sotatek/Documents/cinee-openclaw/cinee-pipline/src/services/replyEngineService.ts`

## Implementation Steps

### 1. `settings.ts` — Add field to interface and export

Add `openClawAnalysisModel: string` to `Settings` interface:

```typescript
export interface Settings {
  // ...existing fields...
  openClawAnalysisModel: string;
}
```

Add to `settings` export object:

```typescript
export const settings: Settings = {
  // ...existing fields...
  openClawAnalysisModel:
    process.env.OPENCLAW_ANALYSIS_MODEL ||
    "openrouter/anthropic/claude-sonnet-4.6",
};
```

### 2. `kolAnalyzerService.ts` — Add optional `model` param to `queueAnalysisTask()`

Current signature:

```typescript
async function queueAnalysisTask(type, prompt, relatedId): Promise<string>;
```

New signature:

```typescript
async function queueAnalysisTask(
  type,
  prompt,
  relatedId,
  model?: string,
): Promise<string>;
```

Update command building:

```typescript
const modelFlag = model ? ` --model ${model}` : "";
const command = `agent --agent ${settings.openClawAgent}${modelFlag} --message '${escapedPrompt}'`;
```

### 3. `kolAnalyzerService.ts` — Pass model when calling for personality

In `learnPersonality()`, update the call:

```typescript
await queueAnalysisTask(
  "personality",
  prompt,
  String(kolId),
  settings.openClawAnalysisModel,
);
```

### 4. `replyEngineService.ts` — Inject model for generate_suggestions

Current command (line ~177):

```typescript
const command = `agent --agent ${appSettings.openClawAgent} --message '${escapedPrompt}'`;
```

New:

```typescript
const command = `agent --agent ${appSettings.openClawAgent} --model ${appSettings.openClawAnalysisModel} --message '${escapedPrompt}'`;
```

## Todo List

- [x] Add `openClawAnalysisModel` to `Settings` interface in `settings.ts`
- [x] Add `openClawAnalysisModel` to `settings` export with env var + default
- [x] Add optional `model?` param to `queueAnalysisTask()`
- [x] Inject `--model` flag in command when `model` is provided
- [x] Pass `settings.openClawAnalysisModel` in `learnPersonality()` call
- [x] Inject `--model` in `replyEngineService.ts` generate_suggestions command
- [x] Run `tsc --noEmit` to verify no type errors

## Success Criteria

- `tsc --noEmit` passes with no errors
- `personality` task command includes `--model openrouter/anthropic/claude-sonnet-4.6`
- `generate_suggestions` task command includes `--model openrouter/anthropic/claude-sonnet-4.6`
- `post_analysis` and `comment_pattern` task commands unchanged (no `--model` flag)
- Setting overridable via `OPENCLAW_ANALYSIS_MODEL` env var

## Risk Assessment

- Low risk — additive change, no existing behavior altered for other task types
- If env var not set, defaults to sonnet — safe fallback
