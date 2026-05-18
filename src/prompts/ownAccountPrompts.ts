/** Own account personality learning prompts */
import { OUTPUT_FORMAT_INSTRUCTION } from "./outputFormat.js";

export const OWN_ACCOUNT_LEARNING_PROMPT = `
Analyze this account's writing style from their recent posts to build a personality profile.

ACCOUNT: @{{handle}} (this is your own account)
RECENT POSTS ({{post_count}} posts):
{{posts_sample}}

Your task:
1. Identify their writing style (casual, professional, meme-heavy, technical, etc.)
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
