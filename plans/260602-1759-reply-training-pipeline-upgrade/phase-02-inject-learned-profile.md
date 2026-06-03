# Phase 02 — Inject Learned Profile into CEO Self-Reply

**Priority:** High (visual win, low risk)
**Status:** Pending
**Blocked by:** Phase 01 (needs fresh learned profile to inject)
**Blocks:** Phase 03 (eval needs prompt+output to measure)

---

## Context Links

- Target function: `src/prompts/promptBuilder.ts:217-261` (`buildReplyPrompt`)
- KOL reply path that **already** injects learned profile: `src/services/replyEngineService.ts:184-208` (use as pattern)
- Self-reply path that **partially** injects learned profile: `src/services/selfReplyService.ts:412-430` (only `writing_style`)
- OwnAccountProfile sub-doc types: `src/db/models/OwnAccountProfile.ts`
- Cron that calls buildReplyPrompt: `src/services/schedulerService.ts:34` (`buildCronJobs`)
- `buildCronJobs` defines: `scrape_x_notifications` is active; `reply_x_notifications` is **commented out** (line 49-54)

---

## Overview

`buildReplyPrompt` is the prompt template for the CEO's reply system on X. Today it only consumes `RoleConfig` (`role.name`, `role.tone`, `role.slangExamples`, `role.blacklistedWords`). It does not consume `OwnAccountProfile.effective_profile` at all — so even if `learnPersonality` runs perfectly, the learned voice never reaches the CEO's reply prompt.

The KOL reply path (`replyEngineService.generateSuggestions`) **already** injects the learned profile by reading `ownProfile.effective_profile` and passing `authorVoiceStyle` / `authorSlangReference` to `buildReplyGenerationPrompt` (the KOL prompt builder, in `src/prompts/kolPrompts.ts`). This phase applies the same pattern to `buildReplyPrompt`.

**Key question for the user (asked in the plan):** the CEO self-reply cron (`reply_x_notifications`) is **commented out** in `schedulerService.ts:49-54`. Should Phase 2 wire the injection even though the cron isn't currently active? **Recommendation: yes** — Phase 2 is the "training pipeline" change. Re-enabling the cron is a separate decision (out of scope; flag in changelog).

---

## Requirements

- `buildReplyPrompt` (and the prompts it delegates to via cron) must include `effective_profile` data when present.
- If `effective_profile` is empty (singleton never learned, or learning_confidence < 60), fall back to the existing `RoleConfig`-only behavior.
- No change to `RoleConfig` shape (per CLAUDE.md — never hardcode persona).
- Tone level, blacklist, slang examples remain `RoleConfig`-driven (learned profile complements, doesn't replace).

---

## Files to Modify

### `src/prompts/promptBuilder.ts` (lines 217-261)

Add new function that augments the prompt with the learned voice block, plus a thin wrapper.

**Option A — minimal change**: add a new exported `buildReplyPromptWithProfile` that takes an `effective_profile` argument and returns the same string with a `LEARNED VOICE` block prepended. Existing `buildReplyPrompt` stays unchanged for backwards compat.

**Option B — change signature**: change `buildReplyPrompt(role, api)` to `buildReplyPrompt(role, api, effectiveProfile?)`. Breaks the 4 existing callers (3 in `schedulerService.ts` and 1 in `buildCronJobs` via `replyPrompt`). Cleaner but larger blast radius.

**Recommendation: Option A.** Add a new exported function, leave the old one alone. The 4 callers can be migrated independently.

New function (~70 lines added to `promptBuilder.ts`):

```typescript
export interface IEffectiveVoiceBlock {
  writing_style: string;
  slang_words: string[];
  emoji_pattern: string;
  sentence_structure: string;
  engagement_tone: string;
  avg_post_length: number;
}

function buildLearnedVoiceBlock(ep: IEffectiveVoiceBlock | null): string {
  if (!ep) return "";
  const parts: string[] = [];
  if (ep.writing_style) parts.push(`Writing style: ${ep.writing_style}`);
  if (ep.sentence_structure) parts.push(`Sentence structure: ${ep.sentence_structure}`);
  if (ep.engagement_tone) parts.push(`Engagement tone: ${ep.engagement_tone}`);
  if (ep.avg_post_length > 0) parts.push(`Target length: ~${ep.avg_post_length} words`);
  if (ep.emoji_pattern) parts.push(`Emoji usage: ${ep.emoji_pattern}`);
  if (ep.slang_words.length > 0) {
    parts.push(`Voice slang to consider (pick 0-2 naturally, never force): ${ep.slang_words.slice(0, 10).join(", ")}`);
  }
  if (parts.length === 0) return "";
  return "\nLEARNED VOICE (from the CEO's recent posted tweets):\n" + parts.join("\n") + "\n";
}

export function buildReplyPromptWithProfile(
  role: RoleConfig,
  apiUrl: string,
  effectiveProfile: IEffectiveVoiceBlock | null,
): string {
  const base = buildReplyPrompt(role, apiUrl);
  const block = buildLearnedVoiceBlock(effectiveProfile);
  if (!block) return base;
  // Insert the LEARNED VOICE block after "Writing rules for the reply:" so it sits next to the other voice rules.
  return base.replace(
    "Writing rules for the reply:",
    `Writing rules for the reply:${block}`,
  );
}
```

### `src/services/schedulerService.ts` (line 34)

In `buildCronJobs()`, fetch the effective profile and pass it to the new builder. Keep the unprofile'd builder for the other 3 prompts (research/draft/interact) — those are about content generation, not voice-mirroring.

```typescript
// In buildCronJobs():
const role = await getActiveRoleConfig();
const ownProfile = await ownAccountService.getProfile();
const effectiveProfile = ownProfile.effective_profile;

const researchPrompt = buildResearchPrompt(role, API);
const draftPrompt = buildDraftPrompt(role, API);
const replyPrompt = buildReplyPromptWithProfile(role, API, effectiveProfile);
const interactPrompt = buildInteractPrompt(role, API);
```

Add import at top:
```typescript
import { ownAccountService } from "./ownAccountService.js";
import { buildReplyPromptWithProfile } from "../prompts/promptBuilder.js";
```

### `src/services/schedulerService.ts` (cron registration, lines 49-54)

`reply_x_notifications` is **commented out** in `buildCronJobs()`. The injection is wired but the cron won't actually run. **Flag in the PR description** — do not re-enable in Phase 2 (separate decision).

---

## Files to Create

None. Pure modification.

---

## Files to Delete

None.

---

## Implementation Steps

1. Add `IEffectiveVoiceBlock` interface + `buildLearnedVoiceBlock` helper + `buildReplyPromptWithProfile` to `src/prompts/promptBuilder.ts`.
2. Export the new function from `src/prompts/index.ts` (verify it's re-exported — `src/prompts/index.ts` is the barrel).
3. Update `buildCronJobs()` in `src/services/schedulerService.ts` to fetch `effectiveProfile` and call the new builder.
4. Verify no other callers of `buildReplyPrompt` are broken (grep `buildReplyPrompt`).
5. Run `npm run typecheck`. Fix any TS errors.

---

## Todo List

- [ ] Add `buildLearnedVoiceBlock` + `buildReplyPromptWithProfile` to `promptBuilder.ts`
- [ ] Verify barrel export in `src/prompts/index.ts` includes new function
- [ ] Update `buildCronJobs` in `schedulerService.ts` to call new builder
- [ ] `grep -r "buildReplyPrompt" src/` to confirm no stale callers
- [ ] `npm run typecheck` passes
- [ ] Manual: inspect a generated `replyPrompt` string — confirm `LEARNED VOICE` block appears when profile is set, absent when empty

---

## Success Criteria

- `buildReplyPromptWithProfile(role, api, null)` returns a string **identical** to `buildReplyPrompt(role, api)`.
- `buildReplyPromptWithProfile(role, api, populatedProfile)` returns a string containing the `LEARNED VOICE` block.
- The injected block sits adjacent to the existing `Writing rules for the reply:` section (verified by regex test).
- `buildCronJobs()` does not throw when `OwnAccountProfile` is missing (singleton hasn't been created yet — fallback to `null`).
- No new env vars; no new cron registration.

---

## Test Strategy

**Unit** (`src/tests/promptBuilder.test.ts`, new file):
- `buildReplyPromptWithProfile(role, api, null)` matches `buildReplyPrompt(role, api)` byte-for-byte.
- `buildReplyPromptWithProfile(role, api, partialProfile)` includes only non-empty fields.
- `buildReplyPromptWithProfile(role, api, fullProfile)` includes all 6 sub-fields.
- The injection point is immediately after `Writing rules for the reply:` (not at the end, not at the beginning).
- `slang_words` is capped at 10 items (avoid prompt bloat).

**Integration**:
- `npm run setup-cron` (or `npm run cron:add-all`) — confirm no errors. Inspect the queued Task prompt — should contain the new block.
- `npm run kol:daemon -- --run-now` — log line shows `effectiveProfile` was fetched (add a `log.info` if needed for verification, then remove).

**Manual**:
- Set `OwnAccountProfile.manual_config` via `PATCH /api/account/personality/manual` with `writing_style: "punchy and lowercase"`.
- Trigger `npm run cron:add:reply` (or use the new builder directly via tsx).
- Inspect the generated prompt — should contain `LEARNED VOICE` block with `Writing style: punchy and lowercase`.

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Learned profile mirrors LLM bias (the project-level risk called out in the request) | High | This is **why** Phase 3 (eval log with `edit_ratio`) is mandatory. The eval log will show whether Phase 2 actually improves reply quality. If `edit_ratio` doesn't improve, we either raise `MIN_POSTS_REQUIRED` (in Phase 1) or revert the injection. |
| The injected block pushes prompt over model context limits | Low | Current `effective_profile` is ~300 tokens max. `buildReplyPrompt` is ~600 tokens. Total well within Sonnet's 200K context. |
| Empty `effective_profile` on a fresh singleton creates a malformed block | Low | `buildLearnedVoiceBlock` returns `""` when all 6 fields are empty. `buildReplyPromptWithProfile` then returns `base` unchanged. |
| KOL reply prompt (`buildReplyGenerationPrompt` in `kolPrompts.ts`) is **not** updated by this phase | Intended | The KOL path already injects `effective_profile` via `replyEngineService.ts:184-208`. Out of scope for Phase 2. |
| User re-enables the `reply_x_notifications` cron and Phase 2 changes the prompt output mid-flight | Low | The prompt is regenerated on each cron tick (no caching). Old in-flight Tasks already have their prompt string captured. No migration needed. |

---

## Security Considerations

- The injected block is built server-side from `OwnAccountProfile.effective_profile`, which is server-controlled. No external user input flows in.
- Slang list is capped at 10 items to prevent prompt-bloat attacks (in case someone sets `slang_words` to a 10K-character array via `PATCH /api/account/personality/manual`). Add a length cap on the PATCH endpoint if not already present (verify in `account.ts:37-61` — currently no cap, but MongoDB schema validation caps at `String[]`).

---

## Unresolved Questions

1. **Should Phase 2 also touch `buildReplyGenerationPrompt` (KOL path, in `kolPrompts.ts`)?** The KOL path already injects `effective_profile` via `replyEngineService.ts:184-208`. No change needed. **Recommendation: out of scope.**
2. **Should the `LEARNED VOICE` block be gated on `learning_confidence >= 60`?** The merge logic in `ownAccountService.mergeProfiles` already does this — `effective_profile` only contains learned values when confidence >= 60 (otherwise it falls back to manual). So gating at this layer is redundant. **Recommendation: trust the merge.**
3. **The `reply_x_notifications` cron is commented out. Should Phase 2 re-enable it?** **Recommendation: NO. This is a separate decision about bot autonomy. Phase 2 is the training-pipeline change. The injection is wired but dormant — when the cron is re-enabled, the new prompt takes effect automatically.**
4. **What if the user wants Phase 2 to apply to self-reply (`selfReplyService.queueSelfReplyGeneration`) and not just the CEO reply cron?** The self-reply path already passes `effective_profile.writing_style` to `buildSelfReplyPrompt` (`selfReplyService.ts:412-430`). Phase 2 does **not** need to touch this — it already works. **Recommendation: leave self-reply alone in Phase 2.**

---

## Next Steps

Phase 03 adds the `ReplyEvalLog` collection and instruments `replyEngineService` + `selfReplyService` to log every prompt+output pair. With Phase 2 in place, the logged prompts will contain the `LEARNED VOICE` block, and the eval log becomes the measurement of whether that block helps.
