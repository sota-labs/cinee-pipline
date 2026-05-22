# Phase 04 — Rebuild Reply Prompt + Call Site

## Context Links
- Source files: `src/prompts/kolPrompts.ts`, `src/services/replyEngineService.ts`
- Related plan: `plan.md`
- Depends on: phases 01-03 (personality guard removal requires model field gone)

## Overview

**Priority:** High  
**Status:** Pending  
**Description:** Change `buildReplyGenerationPrompt()` to accept post-data params instead of personality-profile params, update the `REPLY_GENERATION_PROMPT` template to use a "KOL CONTEXT" section, and update the call site in `replyEngineService.ts` to pass the new fields while removing the personality guard block.

## Key Insights

### kolPrompts.ts
- `REPLY_GENERATION_PROMPT` template (lines 101-165) has a "KOL PROFILE" section using `{{writing_style}}`, `{{topics}}`, `{{tone}}`, and `{{slang_dictionary}}` placeholders.
- `buildReplyGenerationPrompt()` function (lines 240-288) accepts `writingStyle`, `topics`, `slangs`, `slangExamples`, and `tone` — all sourced from `personality_profile`.
- The `slangDict` builder logic (lines 256-261) and the `authorVoiceBlock` builder (lines 263-275) are kept as-is; only the KOL-profile params change.
- `buildPersonalityLearningPrompt` (lines 225-238) and `PERSONALITY_LEARNING_PROMPT` (lines 65-97) are removed since they are no longer called anywhere after phase 02.

### replyEngineService.ts
- The personality guard block is at lines 148-155:
  ```typescript
  if (!kol.personality_profile?.writing_style) {
    log.warn(`[ReplyEngine] KOL @${kol.handle} has no personality profile — queuing learning and reverting post`);
    await kolAnalyzerService.learnPersonality(String(kol._id));
    await KolPost.findByIdAndUpdate(post._id, { status: EKolPostStatus.ANALYZED });
    return null;
  }
  ```
- The `buildReplyGenerationPrompt` call is at lines 158-172, passing `kol.personality_profile.*` fields.
- After the guard is removed, `kolAnalyzerService` import (line 20) may become unused — verify and remove if so.

### New prompt params mapping
| New param | Source in code |
|-----------|---------------|
| `postSummary` | `post.analysis.summary` |
| `trendingTopics` | `post.analysis.trending_topics` |
| `topComments` | `post.top_comments.slice(0, 5)` |
| `dominantTone` | `post.engagement_pattern.dominant_tone` (already passed) |
| `commonPhrases` | `post.engagement_pattern.common_phrases` (already passed) |
| `emojiTrend` | `post.engagement_pattern.emoji_trend` (already passed) |

## Requirements

- `buildReplyGenerationPrompt` must accept the new params and produce a prompt that gives the AI enough KOL context without relying on a learned personality.
- The personality guard block must be removed so suggestion generation is never blocked.
- `PERSONALITY_LEARNING_PROMPT` and `buildPersonalityLearningPrompt` must be removed (no callers remain after phase 02).
- Files must compile cleanly.

## Related Code Files

- **Modify:** `src/prompts/kolPrompts.ts`
- **Modify:** `src/services/replyEngineService.ts`

## Implementation Steps

### kolPrompts.ts — Step 1: Remove personality learning prompt

Delete lines 63-97 — the `PERSONALITY_LEARNING_PROMPT` constant and its section comment:
```typescript
// DELETE this entire block (lines 63-97):
// ── Personality Learning Prompts ─────────────────────────────────────────

export const PERSONALITY_LEARNING_PROMPT = `
Analyze this KOL's writing style from their recent posts to create a personality profile.
...
${OUTPUT_FORMAT_INSTRUCTION}`;
```

### kolPrompts.ts — Step 2: Update REPLY_GENERATION_PROMPT template

Replace the "KOL PROFILE" section inside `REPLY_GENERATION_PROMPT` (lines 111-118 of the current template):

```
// BEFORE (inside the template string):
KOL PROFILE (context for what you're replying to):
Handle: @{{handle}}
Writing Style: {{writing_style}}
Common Topics: {{topics}}
Typical Tone: {{tone}}

KOL SLANG DICTIONARY (understand their world — do NOT copy their style):
{{slang_dictionary}}
```

Replace with:
```
// AFTER:
KOL CONTEXT (context for what you're replying to):
Handle: @{{handle}}
Post Summary: {{post_summary}}
Topics: {{trending_topics}}
Audience Tone: {{dominant_tone}}
Sample Comments:
{{top_comments_sample}}
```

Also remove the `{{slang_dictionary}}` placeholder line and the "KOL SLANG DICTIONARY" label entirely — they are no longer populated.

The full updated template section becomes:
```typescript
export const REPLY_GENERATION_PROMPT = `
Generate 3 reply suggestions for this KOL's post. You are writing as the AUTHOR — replies must sound like the author's voice, not the KOL's.
{{author_voice_block}}
HARD RULES:
- lowercase always (except $TICKER)
- max 2 slang per reply
- no hashtags

---

KOL CONTEXT (context for what you're replying to):
Handle: @{{handle}}
Post Summary: {{post_summary}}
Topics: {{trending_topics}}
Audience Tone: {{dominant_tone}}
Sample Comments:
{{top_comments_sample}}

POST TO REPLY TO:
{{post_content}}

ENGAGEMENT CONTEXT:
Common Phrases Used: {{common_phrases}}
Popular Emojis: {{emoji_trend}}

REQUIREMENTS:
1. Write in the AUTHOR's voice (see AUTHOR VOICE section above)
2. Be contextually relevant to the KOL's post and their world
3. Add genuine value, observation, or sharp humor
4. Avoid generic responses like "Great post!" or "Thanks for sharing"
5. Keep replies between 5-30 words
6. If the post asks a question, answer it or add perspective
7. If the post shares news, add commentary or reaction

Respond in this exact JSON format:
{
  "suggestions": [
    {
      "content": "First reply option...",
      "tone": "casual",
      "confidence": 85,
      "reasoning": "Matches their meme style while adding value",
      "expected_engagement": 8
    },
    {
      "content": "Second reply option...",
      "tone": "witty",
      "confidence": 75,
      "reasoning": "Playful banter that fits their tone",
      "expected_engagement": 6
    },
    {
      "content": "Third reply option...",
      "tone": "supportive",
      "confidence": 70,
      "reasoning": "Genuine agreement with added insight",
      "expected_engagement": 5
    }
  ]
}

Confidence should be 70-95 for high-quality matches, 50-69 for decent matches, below 50 for uncertain.
${OUTPUT_FORMAT_INSTRUCTION}\``;
```

Note: `{{dominant_tone}}` now appears in the KOL CONTEXT section (was previously only in ENGAGEMENT CONTEXT). Remove the duplicate `Dominant Tone in Comments: {{dominant_tone}}` line from the ENGAGEMENT CONTEXT section.

### kolPrompts.ts — Step 3: Update buildReplyGenerationPrompt signature and body

Replace the entire `buildReplyGenerationPrompt` function (lines 240-288):

```typescript
// NEW function signature and body:
export function buildReplyGenerationPrompt(params: {
  handle: string;
  postSummary: string;
  trendingTopics: string[];
  topComments: Array<{ content: string; author_handle: string; sentiment: string }>;
  postContent: string;
  dominantTone: string;
  commonPhrases: string[];
  emojiTrend: string[];
  authorVoiceStyle?: string;
  authorSlangReference?: string;
  authorStyleFormulas?: string;
}): string {
  // Format top comments sample (max 5)
  const commentsSample = params.topComments.slice(0, 5).length > 0
    ? params.topComments
        .slice(0, 5)
        .map((c, i) => `  ${i + 1}. @${c.author_handle} [${c.sentiment}]: "${c.content}"`)
        .join("\n")
    : "  (no comments yet)";

  // Build author voice block — only include sections that have content
  const voiceParts: string[] = [];
  if (params.authorVoiceStyle) {
    voiceParts.push(`AUTHOR VOICE (you are writing as this person):\n${params.authorVoiceStyle}`);
  }
  if (params.authorStyleFormulas) {
    voiceParts.push(`STYLE FORMULAS (pick the one that fits best):\n${params.authorStyleFormulas}`);
  }
  if (params.authorSlangReference) {
    voiceParts.push(`CT SLANG REFERENCE (pick 0-2 that fit naturally — never force):\n${params.authorSlangReference}`);
  }
  const authorVoiceBlock = voiceParts.length > 0
    ? "\n" + voiceParts.join("\n\n") + "\n"
    : "";

  return REPLY_GENERATION_PROMPT
    .replace("{{author_voice_block}}", authorVoiceBlock)
    .replace("{{handle}}", params.handle)
    .replace("{{post_summary}}", params.postSummary)
    .replace("{{trending_topics}}", params.trendingTopics.join(", ") || "(none)")
    .replace("{{top_comments_sample}}", commentsSample)
    .replace("{{post_content}}", params.postContent)
    .replace("{{dominant_tone}}", params.dominantTone)
    .replace("{{common_phrases}}", params.commonPhrases.join(", ") || "(none)")
    .replace("{{emoji_trend}}", params.emojiTrend.join(", ") || "(none)");
}
```

### kolPrompts.ts — Step 4: Remove buildPersonalityLearningPrompt

Delete lines 225-238 — the `buildPersonalityLearningPrompt` function:
```typescript
// DELETE:
export function buildPersonalityLearningPrompt(params: {
  handle: string;
  posts: Array<{ content: string; likes: number }>;
}): string { ... }
```

### replyEngineService.ts — Step 5: Remove personality guard block

Delete lines 148-155:
```typescript
// DELETE:
// Guard: skip suggestion generation if personality hasn't been learned yet
if (!kol.personality_profile?.writing_style) {
  log.warn(`[ReplyEngine] KOL @${kol.handle} has no personality profile — queuing learning and reverting post`);
  await kolAnalyzerService.learnPersonality(String(kol._id));
  // Revert post back to ANALYZED so it can be retried after personality is learned
  await KolPost.findByIdAndUpdate(post._id, { status: EKolPostStatus.ANALYZED });
  return null;
}
```

### replyEngineService.ts — Step 6: Update buildReplyGenerationPrompt call site

Replace lines 158-172 (the `buildReplyGenerationPrompt` call):

```typescript
// BEFORE:
const prompt = buildReplyGenerationPrompt({
  handle: kol.handle,
  writingStyle: kol.personality_profile.writing_style,
  topics: kol.personality_profile.common_topics,
  slangs: kol.personality_profile.slang_words,
  slangExamples: kol.personality_profile.slang_examples || [],
  tone: kol.personality_profile.engagement_tone,
  postContent: post.content,
  dominantTone: post.engagement_pattern.dominant_tone,
  commonPhrases: post.engagement_pattern.common_phrases,
  emojiTrend: post.engagement_pattern.emoji_trend,
  authorVoiceStyle: appSettings.role.authorVoiceStyle,
  authorSlangReference: appSettings.role.authorSlangReference,
  authorStyleFormulas: appSettings.role.authorStyleFormulas,
});

// AFTER:
const prompt = buildReplyGenerationPrompt({
  handle: kol.handle,
  postSummary: post.analysis?.summary ?? "",
  trendingTopics: post.analysis?.trending_topics ?? [],
  topComments: (post.top_comments ?? []).slice(0, 5).map((c) => ({
    content: c.content,
    author_handle: c.author_handle,
    sentiment: c.sentiment ?? "neutral",
  })),
  postContent: post.content,
  dominantTone: post.engagement_pattern?.dominant_tone ?? "neutral",
  commonPhrases: post.engagement_pattern?.common_phrases ?? [],
  emojiTrend: post.engagement_pattern?.emoji_trend ?? [],
  authorVoiceStyle: appSettings.role.authorVoiceStyle,
  authorSlangReference: appSettings.role.authorSlangReference,
  authorStyleFormulas: appSettings.role.authorStyleFormulas,
});
```

### replyEngineService.ts — Step 7: Clean up unused import

After removing the guard block, `kolAnalyzerService` (imported at line 20) is no longer called in this file. Remove the import:
```typescript
// DELETE:
import { kolAnalyzerService } from "./kolAnalyzerService.js";
```

8. Run `npx tsc --noEmit` to confirm no compile errors in both files.

## Todo

- [ ] Delete `PERSONALITY_LEARNING_PROMPT` constant from `kolPrompts.ts` (lines 63-97)
- [ ] Update `REPLY_GENERATION_PROMPT` template — replace KOL PROFILE section with KOL CONTEXT section
- [ ] Remove `{{slang_dictionary}}` placeholder and "KOL SLANG DICTIONARY" label from template
- [ ] Remove duplicate `Dominant Tone in Comments: {{dominant_tone}}` from ENGAGEMENT CONTEXT in template
- [ ] Update `buildReplyGenerationPrompt` signature — remove old params, add new params
- [ ] Update `buildReplyGenerationPrompt` body — replace slangDict logic with commentsSample logic, update `.replace()` calls
- [ ] Delete `buildPersonalityLearningPrompt` function from `kolPrompts.ts` (lines 225-238)
- [ ] Delete personality guard block from `replyEngineService.ts` (lines 148-155)
- [ ] Update `buildReplyGenerationPrompt` call in `replyEngineService.ts` (lines 158-172)
- [ ] Remove `kolAnalyzerService` import from `replyEngineService.ts` (line 20)
- [ ] Verify compile passes for both files

## Success Criteria

- `buildReplyGenerationPrompt` no longer accepts `writingStyle`, `topics`, `slangs`, `slangExamples`, or `tone`.
- `buildReplyGenerationPrompt` accepts `postSummary`, `trendingTopics`, and `topComments`.
- `replyEngineService.generateSuggestions` never blocks on a missing personality profile.
- Both files compile without errors.
- The generated prompt contains "KOL CONTEXT" with post summary, topics, audience tone, and sample comments.

## Risk Assessment

- **Medium risk on the template edit.** The `REPLY_GENERATION_PROMPT` is a multi-line template string — carefully verify all `{{placeholder}}` names match between the template and the `.replace()` calls in the builder. A mismatched placeholder will silently leave the literal `{{...}}` text in the prompt sent to the AI.
- **Low risk on the guard removal.** The only consequence is that posts are no longer blocked — suggestion generation proceeds immediately using post data, which is the desired behavior.
- **Fallback safety:** The new call site uses `?? ""` / `?? []` defaults for all `post.analysis` fields, so posts that completed analysis before this deploy (and may have partial data) will still generate a prompt rather than throwing.
