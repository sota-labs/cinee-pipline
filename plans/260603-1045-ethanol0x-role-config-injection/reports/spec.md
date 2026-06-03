# Spec: @ethanol0x Role Config Injection

**Date:** 2026-06-03  
**Status:** Pending plan

---

## Problem Statement

File `slang/bot_reply_system_prompt_EN.md` defines a complete voice/behavior spec for `@ethanol0x` (crypto CT account) but is not connected to the reply generation pipeline. Currently:

- `buildReplyGenerationPromptWithFewShot()` injects voice via `authorVoiceStyle`, `authorSlangReference`, `authorStyleFormulas` from `RoleConfig`
- These fields in `settings.ts` are hardcoded for the Cinee CEO persona
- `@ethanol0x` has no `RoleConfig` — so reply quality is generic or zero
- AFK semantic blacklist (hack, rug, lawsuit…) in the `.md` spec is not enforced anywhere in code

---

## User Stories

- As the operator, I want replies generated for `@ethanol0x` to match the CT degen voice in the spec
- As the operator, I want posts about hacks, rugs, lawsuits, deaths to be auto-skipped in AFK mode without LLM involvement
- As the operator, I want to switch between Cinee CEO and @ethanol0x by changing one env var, not code

---

## Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Inject method | Distill `.md` → `RoleConfig` JSON fields | ~400 tokens vs ~2000 for full `.md`; fits existing pipeline |
| AFK blacklist | Code-level skip (Option B) | Deterministic, no LLM cost, never misses |
| Config storage | `ethanol0x-role.json` via `ROLE_CONFIG_PATH` | No schema change, no code change to switch accounts |
| 3 safety levels (SAFE/MEDIUM/SHARP) | Distill into `authorStyleFormulas` | Maps naturally to existing formulas field |

---

## Architecture

No new services or DB models. Changes are confined to:

1. **New file:** `config/ethanol0x-role.json` — `RoleConfig` JSON for @ethanol0x
2. **Modified file:** `src/utils/kolPostSkipRules.ts` — add `AFK_SEMANTIC_BLACKLIST` and `shouldSkipBySemantics()` 
3. **Modified file:** `src/services/replyEngineService.ts` — call `shouldSkipBySemantics()` before generating suggestions

```
[KolPost ANALYZED]
       │
       ▼
shouldSkipPost()          ← existing: retweet, CA, DEX domains, cashtag
       │ pass
       ▼
shouldSkipBySemantics()   ← NEW: hack, rug, lawsuit, rip, political, rant
       │ pass
       ▼
passesReplyGate()         ← existing: virality, spam, quality scores
       │ pass
       ▼
buildReplyGenerationPromptWithFewShot()
  └─ authorVoiceStyle     ← distilled from .md VOICE + HARD RULES
  └─ authorSlangReference ← distilled from .md SLANG section
  └─ authorStyleFormulas  ← distilled from .md 3 SAFETY LEVELS
```

---

## Component Specs

### 1. `config/ethanol0x-role.json`

Full `RoleConfig` JSON. Key fields distilled from `.md`:

**`authorVoiceStyle`** (~150 tokens):
```
lowercase always. exception: $TICKER, project names for clarity.
1-2 lines max per reply. one sharp line beats three explaining lines.
no hashtags ever.
max 1 emoji, only if ironic. prefer zero.
drop period at end of one-line replies.
no AI sentence rhythm: no 3 equal-weight clauses, no neat wisdom-line endings.
run-on with commas ok. fragments ok.
replace arrow→ with -> or rephrase. no em-dash — use -. no ellipsis char … use ...
HARD RULES: never bash MevX. never attack named person/KOL. never bash competitors by name aggressively.
never touch: politics, war, religion, race, death/RIP, hacks/rugs accusations against named parties, lawsuits.
never make price predictions. never shill a specific token. never claim unverifiable numbers.
never sound like a reply guy farming: no "great post!", no "this 👆", no empty agreement.
```

**`authorSlangReference`** (~120 tokens):
```
SAFE (deploy 1-2 max, only if fits naturally):
gm, gn, ngl, fr, tbh, based, cooked, rekt, rugged, aped, fomo, jeet, cope, mid, fire, banger,
wagmi, ngmi, lfg, alpha, degen, whale, smart money, anon, ape, bagholder, moon, pump, dump,
slovakia, iykyk, delulu, ratio'd, glazing, shilling, reply guy, mfer, fren, wen, down bad, take an L, printing, narrative, meta, cult, cabal.

NEVER: no cap, bet, goon, gooning, gyatt, rizz, skibidi, any racial/coded term.
CONTEXT-LOCKED: mog = visual/looks only. bussin = food only. chopped/clapped = person appearance only.
DENSITY: market/insight replies = 0-1 slang. vibe/reaction replies = up to 2-3.
```

**`authorStyleFormulas`** (~130 tokens):
```
3 REPLY TONES — always write all 3, in this order:

SAFE: agreement + small added detail, OR light question, OR light relate.
  templates: "yeah and [detail]" / "how are you reading [X]?" / "felt this" / "[X] has been the quiet story this week"
  use: AFK auto-post default, low-risk posts

MEDIUM: light observation with personality and sharpness. has a take, still safe.
  use: user awake, wants some edge

SHARP: full take, contrarian angle, dry dunk on behavior/trend (never on named person). acid not cynical.
  use: user awake, post deserves strong reply
```

**`persona`** (~80 tokens):
```
founder of Lockedin: mobile-first, multi-chain (sol, base, bsc, sui) trading terminal. pro-grade execution on phone.
real trader, not just a founder. trades memecoins, knows the trenches, has lost money and owns it.
builder lens: sees market structure not just price. cares about volume and activity over hype.
western CT native voice. sharp, dry, self-aware, never corporate.
not a hype man, not a shiller, not a guru. competent and a little tired of the noise.
builder identity shows rarely and only organically — do NOT force Lockedin into replies. do NOT shill.
```

Other fields: `name`, `brand`, `tone`, `topics`, `blacklistedWords`, `humanStyleLevel: "heavy"` (to get casual/no-semicolon style).

---

### 2. `src/utils/kolPostSkipRules.ts` — add semantic blacklist

New export added to existing file:

```typescript
export const AFK_SEMANTIC_BLACKLIST = [
  "died", "passed away", "rip", "r.i.p",
  "hack", "hacked", "exploit", "drained",
  "rug", "rugged", "scam", "exit scam",
  "lawsuit", "sue", "sued", "arrested", "investigation",
] as const;

const SEMANTIC_BLACKLIST_RE = new RegExp(
  AFK_SEMANTIC_BLACKLIST.map((w) => `\\b${w}\\b`).join("|"),
  "i",
);

/**
 * Returns true if post content contains AFK-unsafe keywords.
 * Called before reply generation to skip without LLM cost.
 */
export function shouldSkipBySemantics(content: string): boolean {
  return SEMANTIC_BLACKLIST_RE.test(content);
}
```

Note: The `.md` also lists semantic rules that can't be keyword-matched (personal attack/beef between people, political hot take, heavy negative/rant, airdrop scam). These are handled by the existing `passesReplyGate()` quality/spam scores — no additional code needed.

---

### 3. `src/services/replyEngineService.ts` — inject semantic check

In `generateSuggestions()`, after the existing `shouldSkipPost()` call, add:

```typescript
// Semantic AFK blacklist — skip before spending LLM budget
if (shouldSkipBySemantics(post.content)) {
  await KolPost.findByIdAndUpdate(post._id, { status: EKolPostStatus.SKIPPED });
  log.info(`[ReplyEngine] Skipped post ${post._id} — matched semantic blacklist`);
  return null;
}
```

This runs regardless of KOL tier (unlike `shouldSkipPost` which bypasses for tier S). Hard safety rule — tier S should not reply to death/hack posts either.

---

## Token Cost Impact

| Component | Before | After |
|-----------|--------|-------|
| Voice injection per reply call | 0 (no ethanol0x config) | ~400 tokens |
| Full `.md` if injected raw | — | ~2,000 tokens |
| Savings vs raw injection | — | ~1,600 tokens/call (~80%) |
| AFK semantic check | LLM decides (0 or in prompt) | 0 (regex, no LLM) |

---

## Interface Contracts

**`shouldSkipBySemantics(content: string): boolean`**  
Pure function. No DB, no async. Returns true = skip post.

**`ethanol0x-role.json`** must satisfy `Partial<RoleConfig>` interface — merged with `defaultRoleConfig` in `loadRoleConfig()`.

---

## Files to Create

- `config/ethanol0x-role.json`

## Files to Modify

- `src/utils/kolPostSkipRules.ts` — add `AFK_SEMANTIC_BLACKLIST` + `shouldSkipBySemantics()`
- `src/services/replyEngineService.ts` — call `shouldSkipBySemantics()` in `generateSuggestions()`

## Files NOT Modified

- `src/prompts/kolPrompts.ts` — no changes needed
- `src/config/settings.ts` — no changes needed
- DB models — no changes needed

---

## Testing Strategy

1. Unit test `shouldSkipBySemantics()` — keyword hits, case-insensitive, word boundary
2. Unit test `generateSuggestions()` mock — semantic blacklist triggers skip, logs correctly
3. Manual: set `ROLE_CONFIG_PATH=./config/ethanol0x-role.json`, verify loaded config matches expected fields
4. Manual: generate one reply with ethanol0x config, verify voice matches CT style

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Regex false positives (e.g. "hacked together" = casual dev term) | Word boundary `\b` reduces this. Acceptable tradeoff vs missing real hacks |
| `.md` has rules not captured in distillation | Hard rules and slang context-locks are fully preserved. 3 safety levels fully mapped. Minimal loss |
| Config file path wrong in .env | `loadRoleConfig()` already has fallback to defaultRoleConfig with a console.warn |

---

## Success Criteria

- Reply content for @ethanol0x posts uses lowercase, CT slang, ≤2 lines, no hashtags
- Posts containing "hack", "rug", "lawsuit" etc. are skipped before LLM call
- Switching between Cinee CEO and @ethanol0x requires only `ROLE_CONFIG_PATH` env change
- Token usage per reply generation call ≤ 500 tokens for voice block (vs ~2,000 for full .md)
