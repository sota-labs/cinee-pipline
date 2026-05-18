# Phase 05 — KOL Slang Learning with Context

**Priority:** Medium (independent of Phase 1-4)
**Status:** Pending

---

## Context Links

- KolProfile model: `src/db/models/KolProfile.ts` (line 9: `slang_words: string[]`)
- Personality learning prompt: `src/prompts/kolPrompts.ts` (line 58: `PERSONALITY_LEARNING_PROMPT`)
- Reply generation prompt: `src/prompts/kolPrompts.ts` (line 88: `REPLY_GENERATION_PROMPT`)
- Analyzer service: `src/services/kolAnalyzerService.ts` (`applyPersonalityUpdate()` line 363)
- Reply engine: `src/services/replyEngineService.ts` (`generateSuggestions()` line 136)

---

## Overview

Currently slang is stored as a flat list (`["ngmi", "wagmi", "ser"]`) and passed to the reply prompt as `Frequent Slangs: ngmi, wagmi, ser`. The AI doesn't know *how* or *when* to use each word.

Improve by:
1. Extracting slang with usage context during personality learning
2. Injecting a "slang dictionary" into reply generation prompts

---

## Implementation Steps

### 1. Extend `IPersonalityProfile` in `src/db/models/KolProfile.ts`

Add new field (keep `slang_words` for backward compat):

```typescript
export interface ISlangExample {
  word: string;
  context: string; // e.g. "used to mock bad decisions: 'still holding that bag... ngmi'"
}

export interface IPersonalityProfile {
  writing_style: string;
  common_topics: string[];
  slang_words: string[];
  slang_examples: ISlangExample[]; // NEW
  emoji_pattern: string;
  sentence_structure: string;
  engagement_tone: string;
  avg_post_length: number;
}
```

Add to schema:

```typescript
slang_examples: {
  type: [{ word: String, context: String }],
  default: [],
},
```

### 2. Update `PERSONALITY_LEARNING_PROMPT` in `src/prompts/kolPrompts.ts`

Change the output format to include slang context:

```
3. Extract slang words and phrases they frequently use, WITH an example of how they use it

"slang_words": ["ngmi", "wagmi", "ser"],
"slang_examples": [
  { "word": "ngmi", "context": "mocking bad decisions: 'still holding that bag... ngmi'" },
  { "word": "wagmi", "context": "bullish encouragement: 'just keep building, wagmi'" },
  { "word": "ser", "context": "addressing someone: 'ser, this is the alpha'" }
]
```

### 3. Update `REPLY_GENERATION_PROMPT` in `src/prompts/kolPrompts.ts`

Replace the flat slang line with a dictionary section:

```
SLANG DICTIONARY (use naturally when the context fits):
{{slang_dictionary}}
```

Where `{{slang_dictionary}}` renders as:
```
- "ngmi" — mocking bad decisions: "still holding that bag... ngmi"
- "ser" — addressing someone: "ser, this is the alpha"
```

### 4. Update `buildReplyGenerationPrompt()` signature

```typescript
export function buildReplyGenerationPrompt(params: {
  handle: string;
  writingStyle: string;
  topics: string[];
  slangs: string[];
  slangExamples: Array<{ word: string; context: string }>; // NEW
  tone: string;
  postContent: string;
  dominantTone: string;
  commonPhrases: string[];
  emojiTrend: string[];
}): string {
  // Format slang dictionary
  const slangDict = params.slangExamples.length > 0
    ? params.slangExamples.map((s) => `- "${s.word}" — ${s.context}`).join("\n")
    : params.slangs.map((s) => `- "${s}"`).join("\n"); // fallback to flat list

  return REPLY_GENERATION_PROMPT
    .replace("{{slang_dictionary}}", slangDict)
    // ... rest of replacements
}
```

### 5. Update `processPersonalityResult()` in `src/services/kolAnalyzerService.ts`

Parse the new `slang_examples` field from AI output:

```typescript
return {
  writingStyle: parsed.writing_style || "",
  commonTopics: parsed.common_topics || [],
  slangWords: parsed.slang_words || [],
  slangExamples: (parsed.slang_examples || []).map((s: any) => ({
    word: String(s.word || ""),
    context: String(s.context || ""),
  })),
  // ... rest
};
```

### 6. Update `applyPersonalityUpdate()` in `src/services/kolAnalyzerService.ts`

```typescript
kol.personality_profile = {
  // ... existing fields
  slang_examples: update.slangExamples || [],
};
```

### 7. Update `generateSuggestions()` in `src/services/replyEngineService.ts`

Pass slang examples to prompt builder:

```typescript
const prompt = buildReplyGenerationPrompt({
  // ... existing params
  slangExamples: kol.personality_profile.slang_examples || [],
});
```

---

## Done When

- [ ] `ISlangExample` interface defined
- [ ] `slang_examples` field added to KolProfile schema
- [ ] `PERSONALITY_LEARNING_PROMPT` asks for slang with context
- [ ] `REPLY_GENERATION_PROMPT` uses slang dictionary format
- [ ] `buildReplyGenerationPrompt()` formats slang dictionary
- [ ] `processPersonalityResult()` parses slang examples
- [ ] `applyPersonalityUpdate()` stores slang examples
- [ ] `generateSuggestions()` passes slang examples to prompt
- [ ] Backward compat: falls back to flat `slang_words` if no examples
- [ ] `npx tsc --noEmit` passes
