# Phase 02 — Own Account Learning Service + Prompts + Cron

**Priority:** High (blocks Phase 03 webhook handler)
**Status:** Pending
**Blocked by:** Phase 01

---

## Context Links

- Researcher report: `plans/reports/researcher-own-account-personality.md`
- Pattern reference: `src/services/kolAnalyzerService.ts` (`learnPersonality`, `queueAnalysisTask`)
- Pattern reference: `src/prompts/kolPrompts.ts` (`PERSONALITY_LEARNING_PROMPT`, `buildPersonalityLearningPrompt`)
- Pattern reference: `src/scripts/kolAnalyzeCron.ts` (cron structure)
- Model: `src/db/models/OwnAccountProfile.ts` (Phase 01 output)
- Data source: `src/db/models/Post.ts` (`raw_content`, `status: EPostStatus.POSTED`)

---

## Overview

Three files:
1. `src/prompts/ownAccountPrompts.ts` — prompt template adapted for own-account context
2. `src/services/ownAccountService.ts` — singleton fetch, manual config update, personality learning queue, result application, merge logic
3. `src/scripts/ownAccountLearnCron.ts` — daily 03:00 AM cron entry point

---

## Requirements

- Minimum 10 own posts required (vs KOL's 5) — CEO has more posting history
- Query `Post` collection: `status = POSTED`, `platform = "twitter"`, last 30 days, sort `created_at: -1`
- Use `raw_content` field (not `content` — `Post` model uses `raw_content`)
- Slice to first 20 posts, truncate each to 200 chars (same as KOL pattern)
- Task creation: `type: ETaskType.CRON_JOB_TRIGGER`, `payload.analysisType: "own_account_personality"` (distinct from KOL's `"personality"`)
- Merge logic: manual_config is baseline; learned values override when `learning_confidence >= 60`; `slang_words` always union (deduplicated)
- `settings.openClawAgent` for agent name (from `src/config/settings.ts`)

---

## Files to Create

### `src/prompts/ownAccountPrompts.ts` (~60 lines)

Adapt `PERSONALITY_LEARNING_PROMPT` for own-account context. Key differences:
- Replace "KOL: @{{handle}}" with "ACCOUNT: @{{handle}} (this is your own account)"
- Add instruction: "This profile will be used to generate authentic replies in your own voice"
- Keep same JSON output shape as `PERSONALITY_LEARNING_PROMPT` (same fields, no `common_topics` — own account doesn't need topic tracking for reply generation)

```typescript
export const OWN_ACCOUNT_LEARNING_PROMPT = `
Analyze this account's writing style from their recent posts to build a personality profile.

ACCOUNT: @{{handle}} (this is your own account)
RECENT POSTS ({{post_count}} posts):
{{posts_sample}}

Your task:
1. Identify their writing style (casual, professional, meme-heavy, etc.)
2. Extract slang words and phrases they frequently use
3. Note their emoji usage patterns
4. Describe their typical sentence structure
5. Identify their tone when engaging (supportive, sarcastic, educational, etc.)
6. Estimate their average post length in words

This profile will be used to generate authentic replies in your own voice.

Respond in this exact JSON format:
{
  "writing_style": "casual with technical depth",
  "slang_words": ["ngmi", "wagmi", "ser"],
  "emoji_pattern": "frequent 🔥, occasional 💎",
  "sentence_structure": "short punchy sentences",
  "engagement_tone": "bullish and direct",
  "avg_post_length": 20
}
${OUTPUT_FORMAT_INSTRUCTION}`;
```

Builder function:
```typescript
export function buildOwnAccountLearningPrompt(params: {
  handle: string;
  posts: Array<{ content: string }>;
}): string {
  const sample = params.posts
    .slice(0, 20)
    .map((p, i) => `Post ${i + 1}: "${p.content.substring(0, 200)}"`)
    .join("\n\n");

  return OWN_ACCOUNT_LEARNING_PROMPT
    .replace("{{handle}}", params.handle)
    .replace("{{post_count}}", String(params.posts.length))
    .replace("{{posts_sample}}", sample);
}
```

---

### `src/services/ownAccountService.ts` (~160 lines)

Split into two files if it exceeds 200 lines: `ownAccountService.ts` (public API) + `ownAccountMerge.ts` (merge logic).

#### Imports needed:
```typescript
import { log } from "../utils/logger.js";
import { settings } from "../config/settings.js";
import { OwnAccountProfile } from "../db/models/OwnAccountProfile.js";
import type { IOwnAccountManualConfig, IOwnAccountLearnedProfile } from "../db/models/OwnAccountProfile.js";
import { Post, EPostStatus } from "../db/models/Post.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";
import { buildOwnAccountLearningPrompt } from "../prompts/ownAccountPrompts.js";
```

#### Method: `getProfile()`

```typescript
async getProfile(): Promise<IOwnAccountProfile> {
  const existing = await OwnAccountProfile.findOne({ _key: "own_account" });
  if (existing) return existing;
  return OwnAccountProfile.create({ _key: "own_account" });
}
```

#### Method: `updateManualConfig(config: Partial<IOwnAccountManualConfig>)`

```typescript
async updateManualConfig(config: Partial<IOwnAccountManualConfig>): Promise<IOwnAccountProfile> {
  const profile = await this.getProfile();
  Object.assign(profile.manual_config, config);
  profile.effective_profile = this.mergeProfiles(profile.manual_config, profile.learned_profile);
  await profile.save();
  log.info("[OwnAccount] Manual config updated, effective_profile recomputed");
  return profile;
}
```

#### Method: `learnPersonality()`

```typescript
async learnPersonality(): Promise<string | null> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const posts = await Post.find({
    status: EPostStatus.POSTED,
    platform: "twitter",
    created_at: { $gte: thirtyDaysAgo },
  }).sort({ created_at: -1 });

  if (posts.length < 10) {
    log.info(`[OwnAccount] Not enough posts to learn personality (${posts.length} < 10)`);
    return null;
  }

  const handle = settings.twitterHandle ?? "own_account";
  const prompt = buildOwnAccountLearningPrompt({
    handle,
    posts: posts.map((p) => ({ content: p.raw_content })),
  });

  const escapedPrompt = prompt.replace(/'/g, "'\\''");
  const command = `agent --agent ${settings.openClawAgent} --message '${escapedPrompt}'`;

  const task = await Task.create({
    type: ETaskType.CRON_JOB_TRIGGER,
    agent: settings.openClawAgent,
    prompt: command,
    status: ETaskStatus.PENDING,
    payload: { analysisType: "own_account_personality" },
  });

  log.info(`[OwnAccount] Queued personality learning task: ${task._id}`);
  return String(task._id);
}
```

**Note on `settings.twitterHandle`:** Check `src/config/settings.ts` during implementation. If the field doesn't exist, use `process.env.TWITTER_HANDLE ?? "own_account"` as fallback.

#### Method: `applyLearnedProfile(rawResult: string)`

Parse AI JSON output (same shape as `PERSONALITY_LEARNING_PROMPT` response, minus `common_topics`):

```typescript
async applyLearnedProfile(rawResult: string): Promise<boolean> {
  const profile = await this.getProfile();

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResult);
  } catch {
    log.error("[OwnAccount] Failed to parse AI result for personality learning");
    return false;
  }

  if (!parsed || typeof parsed !== "object") return false;
  const data = parsed as Record<string, unknown>;

  // Validate required fields
  if (typeof data.writing_style !== "string") return false;

  const confidence = typeof data.learning_confidence === "number"
    ? Math.min(100, Math.max(0, data.learning_confidence))
    : 75; // default confidence when AI doesn't return it

  profile.learned_profile = {
    writing_style: String(data.writing_style ?? ""),
    slang_words: Array.isArray(data.slang_words) ? (data.slang_words as string[]) : [],
    emoji_pattern: String(data.emoji_pattern ?? ""),
    sentence_structure: String(data.sentence_structure ?? ""),
    engagement_tone: String(data.engagement_tone ?? ""),
    avg_post_length: typeof data.avg_post_length === "number" ? data.avg_post_length : 0,
    last_learned_at: new Date(),
    posts_analyzed: profile.learned_profile.posts_analyzed + 1,
    learning_confidence: confidence,
  };

  profile.effective_profile = this.mergeProfiles(profile.manual_config, profile.learned_profile);
  await profile.save();

  log.info(`[OwnAccount] Applied learned profile (confidence: ${confidence})`);
  return true;
}
```

#### Method: `mergeProfiles(manual, learned)` — private

Merge rules:
- Manual config is always the baseline
- Learned values override when `learning_confidence >= 60`
- `slang_words` always union (manual + learned, deduplicated via `Set`)

```typescript
private mergeProfiles(
  manual: IOwnAccountManualConfig,
  learned: IOwnAccountLearnedProfile,
): IOwnAccountEffectiveProfile {
  const useLearnedText = learned.learning_confidence >= 60;

  return {
    writing_style: useLearnedText && learned.writing_style
      ? learned.writing_style
      : manual.writing_style,
    emoji_pattern: useLearnedText && learned.emoji_pattern
      ? learned.emoji_pattern
      : manual.emoji_pattern,
    sentence_structure: useLearnedText && learned.sentence_structure
      ? learned.sentence_structure
      : manual.sentence_structure,
    engagement_tone: useLearnedText && learned.engagement_tone
      ? learned.engagement_tone
      : manual.engagement_tone,
    avg_post_length: useLearnedText && learned.avg_post_length > 0
      ? learned.avg_post_length
      : manual.avg_post_length,
    // slang_words: always union
    slang_words: [...new Set([...manual.slang_words, ...learned.slang_words])],
  };
}
```

---

### `src/scripts/ownAccountLearnCron.ts` (~40 lines)

Exact same structure as `kolAnalyzeCron.ts`:

```typescript
/** OwnAccountLearnCron — Daily personality learning from own posts */
import { ownAccountService } from "../services/ownAccountService.js";
import { connectDb, disconnectDb } from "../db/connection.js";
import { log } from "../utils/logger.js";

async function main(): Promise<void> {
  try {
    await connectDb();
    log.info("[OwnAccountLearnCron] Connected to DB. Starting personality learning...");

    const taskId = await ownAccountService.learnPersonality();

    if (taskId) {
      log.info(`[OwnAccountLearnCron] Queued learning task: ${taskId}`);
    } else {
      log.info("[OwnAccountLearnCron] Skipped — not enough posts");
    }

    await disconnectDb();
    process.exit(0);
  } catch (error) {
    log.error(`[OwnAccountLearnCron] Fatal error: ${(error as Error).message}`);
    await disconnectDb().catch(() => {});
    process.exit(1);
  }
}

const isMainModule = process.argv[1] && (
  process.argv[1].endsWith("ownAccountLearnCron.ts") ||
  process.argv[1].endsWith("ownAccountLearnCron.js")
);

if (isMainModule) {
  main();
}

export { main as runOwnAccountLearnCron };
```

**Cron schedule:** Daily at 03:00 AM. Register in `src/scripts/setupCronJobs.ts` (or equivalent) with schedule `"0 3 * * *"`.

---

## Todo List

- [ ] Check `src/config/settings.ts` for `twitterHandle` field — add `TWITTER_HANDLE` env var fallback if missing
- [ ] Create `src/prompts/ownAccountPrompts.ts` with `OWN_ACCOUNT_LEARNING_PROMPT` and `buildOwnAccountLearningPrompt()`
- [ ] Create `src/services/ownAccountService.ts` with `OwnAccountService` class
  - [ ] `getProfile()` — singleton fetch/create
  - [ ] `updateManualConfig()` — update + recompute effective
  - [ ] `learnPersonality()` — query Post, check threshold, queue Task
  - [ ] `applyLearnedProfile()` — parse AI JSON, update learned + effective
  - [ ] `mergeProfiles()` — private merge with confidence gate + slang union
- [ ] Export `ownAccountService` singleton
- [ ] Create `src/scripts/ownAccountLearnCron.ts`
- [ ] Register cron in `setupCronJobs.ts` at `"0 3 * * *"`
- [ ] Verify all files compile with `tsc --noEmit`

---

## Success Criteria

- `ownAccountService.learnPersonality()` creates a Task record with `payload.analysisType = "own_account_personality"`
- `ownAccountService.applyLearnedProfile(rawJson)` updates `learned_profile` and recomputes `effective_profile`
- `mergeProfiles` returns manual values when `learning_confidence < 60`, learned values when `>= 60`, always unions `slang_words`
- Cron script exits 0 on success, 1 on error

---

## Risk Assessment

- **Medium:** `settings.twitterHandle` may not exist — verify during implementation
- **Low:** Post query uses `created_at` (not `posted_at` — `Post` model uses `created_at` timestamps)
- **Low:** AI may not return `learning_confidence` field — default to 75 when absent

---

## Security Considerations

- Prompt escaping: `prompt.replace(/'/g, "'\\''")` — same pattern as `kolAnalyzerService.ts`
- No secrets in Task payload — only `analysisType` discriminator

---

## Next Steps

Phase 03 imports `ownAccountService` and calls `applyLearnedProfile` from the webhook handler.
