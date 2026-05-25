---
status: completed
phase: 04
blockedBy: phase-03
completed: 2026-05-25
completion_note: "Completed as blocked — prompt caching not implemented due to OpenClaw CLI limitation. See TODO comment in replyEngineService.ts."
---

# Phase 04 — Prompt Caching for Author Voice Block

## Context Links

- Spec: [spec.md](./spec.md#optimization-4-prompt-caching-for-author-voice)
- Target file: `src/services/replyEngineService.ts`
- Related: `src/prompts/kolPrompts.ts` — `buildReplyGenerationPrompt()`

## Overview

- Priority: Medium (requires verifying OpenRouter support first)
- Savings: ~$0.4/day
- Author voice block (~550 tokens) is constant per account across all reply gen calls
- Cache it via `cache_control` on the message block — cache reads cost 10% of normal input price
- Saves ~550 tokens × 90% discount per call

## Key Insights

- `buildReplyGenerationPrompt()` in `kolPrompts.ts` (line 187) assembles `authorVoiceBlock` from 3 parts: `authorVoiceStyle`, `authorStyleFormulas`, `authorSlangReference`
- The assembled `authorVoiceBlock` is ~2,200 chars / ~550 tokens — same for all posts from same account
- Dynamic part: post context (handle, summary, topics, comments, content) — changes per post
- Current task creation in `generateSuggestions()` (line 186): builds a single string prompt, passes as `--message '...'` CLI arg
- OpenClaw tasks use CLI `agent --message '...'` — this is NOT a direct API call with structured messages
- **Critical dependency:** `cache_control` requires structured API messages (array of content blocks), NOT a flat string prompt passed via CLI
- Must verify: does OpenClaw/cinee-worker support structured message format with `cache_control` blocks?

## Requirements

- Verify OpenRouter passes `cache_control` through to Anthropic API
- Verify cinee-worker/OpenClaw supports structured message format (not just flat `--message` string)
- If supported: restructure reply gen prompt so static author voice block is first (cacheable), dynamic post context after
- If NOT supported: document blocker, skip or implement direct Anthropic API call for reply gen

## Architecture

### If OpenRouter + OpenClaw support cache_control:

```
Task payload (structured):
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "<author voice block>",
          cache_control: { type: "ephemeral" }   ← cached, same per account
        },
        {
          type: "text",
          text: "<dynamic post context + instructions>"  ← changes per post
        }
      ]
    }
  ]
```

### If NOT supported (fallback):

Keep current flat string prompt. Document that caching requires direct API integration.
Consider adding a `REPLY_GEN_STATIC_PREFIX` env var approach for future direct API path.

## Related Code Files

- `/home/sotatek/Documents/cinee-openclaw/cinee-pipline/src/services/replyEngineService.ts`
  - `generateSuggestions()` — lines 164–219 — task creation block
  - Line 186: `const command = \`agent --agent ... --message '${escapedPrompt}'\``

- `/home/sotatek/Documents/cinee-openclaw/cinee-pipline/src/prompts/kolPrompts.ts`
  - `buildReplyGenerationPrompt()` — lines 187–231
  - `REPLY_GENERATION_PROMPT` — lines 65–127 — restructure to separate static/dynamic sections

- Check cinee-worker source or OpenClaw docs for structured message support

## Implementation Steps

### Step 1: Verify OpenRouter cache_control support (REQUIRED FIRST)

Check OpenRouter docs or test endpoint:
- OpenRouter supports `cache_control` for Anthropic models via the `anthropic_beta` header
- Verify: `POST /chat/completions` with `anthropic_beta: ["prompt-caching-2024-07-31"]` header
- Verify: content blocks with `cache_control: { type: "ephemeral" }` pass through

### Step 2: Verify cinee-worker/OpenClaw structured message support

Check if OpenClaw CLI `agent` command supports `--messages-file` or JSON payload instead of flat `--message` string.
Options:
- a) OpenClaw supports `--messages` JSON arg
- b) Task payload can include a `messages` array that cinee-worker uses directly
- c) Neither — must use direct API call

### Step 3a: If structured messages supported

Refactor `buildReplyGenerationPrompt()` to return two parts:

```typescript
export function buildReplyGenerationParts(params: { ... }): {
  staticBlock: string;   // author voice — cacheable
  dynamicBlock: string;  // post context — per-post
} {
  // staticBlock = author voice + style formulas + slang reference
  // dynamicBlock = KOL context + post content + requirements + JSON format
}
```

Update `generateSuggestions()` to create task with structured messages:

```typescript
const { staticBlock, dynamicBlock } = buildReplyGenerationParts({ ... });

const messages = [
  {
    role: "user",
    content: [
      { type: "text", text: staticBlock, cache_control: { type: "ephemeral" } },
      { type: "text", text: dynamicBlock },
    ],
  },
];

// Pass messages as JSON to task payload or via supported CLI arg
```

### Step 3b: If NOT supported

Add a comment block in `generateSuggestions()` documenting the blocker:

```typescript
// TODO: Prompt caching for author voice block (~550 tokens, ~$0.4/day savings)
// Blocked: OpenClaw CLI uses flat --message string; cache_control requires structured messages.
// To enable: switch reply gen to direct Anthropic/OpenRouter API call with messages array.
```

Keep current implementation unchanged.

### Step 4: If implemented — run typecheck + verify

```bash
npm run typecheck
```

Verify task payload structure is correct. Test with a single post.

## Todo List

- [x] Check OpenRouter docs — confirm `cache_control` support for Anthropic models
- [x] Check cinee-worker/OpenClaw — confirm structured message format support
- [x] Decision: implement or document blocker
- [x] If blocked: add TODO comment in `generateSuggestions()` documenting blocker

## Success Criteria

- If implemented: reply gen tasks use structured messages with `cache_control` on author voice block
- If implemented: cache hit rate > 80% (same account, multiple posts)
- If blocked: blocker clearly documented with path to resolution
- No TypeScript errors either way

## Risk Assessment

- **OpenClaw compatibility:** High probability this is blocked by flat CLI `--message` format. Investigate before writing any code.
- **Cache invalidation:** Author voice block changes when `ROLE_CONFIG_PATH` changes or `ownAccountService` updates `writing_style`. Cache TTL is 5 min (Anthropic ephemeral) — acceptable.
- **Anthropic-only:** `cache_control` is Anthropic-specific. If model is switched away from Sonnet for reply gen, caching breaks silently (no error, just no savings).
- **OpenRouter header passthrough:** OpenRouter may require explicit `anthropic_beta` header — verify this is configurable in OpenClaw task payload.

## Next Steps

This is the final phase. After completion:
- Monitor daily AI cost for 3–5 days
- Compare `virality_score` distribution before/after Phase 3 (Minimax quality check)
- Adjust thresholds in Phase 2 gate if needed based on observed filter rates
