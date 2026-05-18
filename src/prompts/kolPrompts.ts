/** KOL Analysis Prompts — AI prompts for personality learning and reply generation */
import { OUTPUT_FORMAT_INSTRUCTION } from "./outputFormat.js";

// ── Post Analysis Prompts ─────────────────────────────────────────────────────

export const POST_ANALYSIS_PROMPT = `
Analyze this social media post and extract key insights.

POST CONTENT:
{{post_content}}

ENGAGEMENT METRICS:
- Likes: {{likes}}
- Comments: {{comments}}
- Retweets: {{retweets}}
- Views: {{views}}

Your task:
1. Write a concise 2-3 sentence summary of the post
2. Determine the sentiment (positive/negative/neutral)
3. Identify up to 3 trending topics mentioned
4. Calculate a virality score (0-100) based on engagement rate

Respond in this exact JSON format:
{
  "summary": "...",
  "sentiment": "positive|negative|neutral",
  "trending_topics": ["topic1", "topic2", "topic3"],
  "virality_score": 75
}
${OUTPUT_FORMAT_INSTRUCTION}`;

export const COMMENT_PATTERN_PROMPT = `
Analyze these top comments to identify engagement patterns.

TOP COMMENTS:
{{top_comments}}

Your task:
1. Identify the dominant tone (humor/agreement/debate/curiosity/questions)
2. Extract common phrases/slangs that appear multiple times
3. Note emoji patterns and frequently used emojis
4. Calculate the percentage of comments that are questions
5. Identify what types of replies get the most likes

Respond in this exact JSON format:
{
  "dominant_tone": "humor|agreement|debate|curiosity|questions",
  "common_phrases": ["phrase1", "phrase2"],
  "emoji_trend": ["emoji1", "emoji2"],
  "question_ratio": 0.3,
  "successful_reply_types": "short witty responses|detailed explanations|agreement with added value"
}
${OUTPUT_FORMAT_INSTRUCTION}`;

// ── Personality Learning Prompts ─────────────────────────────────────────────

export const PERSONALITY_LEARNING_PROMPT = `
Analyze this KOL's writing style from their recent posts to create a personality profile.

KOL: @{{handle}}
RECENT POSTS ({{post_count}} posts):
{{posts_sample}}

Your task:
1. Identify their writing style (casual, professional, aggressive, meme-heavy, etc.)
2. List their common discussion topics
3. Extract slang words and phrases they frequently use, WITH a short example of how they use each one
4. Note their emoji usage patterns
5. Describe their typical sentence structure
6. Identify their tone when engaging (supportive, sarcastic, educational, etc.)
7. Estimate their average post length in words

Respond in this exact JSON format:
{
  "writing_style": "casual, meme-heavy with technical depth",
  "common_topics": ["crypto", "AI", "startups", "web3"],
  "slang_words": ["ngmi", "wagmi", "ser", "gm"],
  "slang_examples": [
    { "word": "ngmi", "context": "mocking bad decisions: 'still holding that bag... ngmi'" },
    { "word": "wagmi", "context": "bullish encouragement: 'just keep building, wagmi'" },
    { "word": "ser", "context": "addressing someone directly: 'ser, this is the alpha'" },
    { "word": "gm", "context": "casual greeting to open a post: 'gm, big news today'" }
  ],
  "emoji_pattern": "frequent 🔥, occasional 💎, rare 😂",
  "sentence_structure": "short punchy sentences, occasional long threads",
  "engagement_tone": "bullish and supportive but calls out BS",
  "avg_post_length": 25
}
${OUTPUT_FORMAT_INSTRUCTION}`;

// ── Reply Generation Prompts ─────────────────────────────────────────────────

export const REPLY_GENERATION_PROMPT = `
Generate 3 reply suggestions for this KOL's post. Your replies should match their personality and resonate with their audience.

KOL PROFILE:
Handle: @{{handle}}
Writing Style: {{writing_style}}
Common Topics: {{topics}}
Typical Tone: {{tone}}

SLANG DICTIONARY (use these naturally when the context fits — don't force them):
{{slang_dictionary}}

POST TO REPLY TO:
{{post_content}}

ENGAGEMENT CONTEXT:
Dominant Tone in Comments: {{dominant_tone}}
Common Phrases Used: {{common_phrases}}
Popular Emojis: {{emoji_trend}}

REQUIREMENTS:
1. Match the KOL's personality and posting style
2. Use slang from the dictionary above when it fits naturally
3. Add genuine value or humor
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
${OUTPUT_FORMAT_INSTRUCTION}`;

// ── Self-Reply Generation Prompt ────────────────────────────────────────────

export const SELF_REPLY_GENERATION_PROMPT = `
Generate a reply to this comment on your own post.

YOUR POST:
{{original_post_content}}

COMMENT TO REPLY TO:
Author: @{{comment_author}}
Content: {{comment_content}}
Likes: {{comment_likes}}

COMMENT AUTHOR CONTEXT:
Trust Score: {{author_trust_score}}/100
Historical Interactions: {{interaction_count}}

REPLY GUIDELINES:
1. Be authentic to your voice ({{your_style}})
2. Match the energy of their comment
3. For high-engagement comments: add value or ask follow-up
4. For questions: answer directly and helpfully
5. For trolls/low-quality: ignore or witty dismissal
6. Keep it conversational, not corporate
7. Use emojis sparingly but naturally

Respond with just the reply text (no JSON, no quotes, max 50 words):
${OUTPUT_FORMAT_INSTRUCTION}`;

// ── Safety Check Prompts ───────────────────────────────────────────────────

export const POST_QUALITY_CHECK_PROMPT = `
Quick safety check for this post before replying.

POST CONTENT:
{{post_content}}

Check for:
1. Spam indicators (excessive hashtags, all caps, suspicious links)
2. Controversial/harmful content
3. Engagement authenticity (are comments organic or bot-like?)
4. Hidden/flagged content indicators

Respond in this exact JSON format:
{
  "is_spam": false,
  "is_hidden": false,
  "is_controversial": false,
  "quality_score": 85,
  "risk_factors": ["none"],
  "recommendation": "proceed"
}
${OUTPUT_FORMAT_INSTRUCTION}`;

// ── Prompt Builders ─────────────────────────────────────────────────────────

export function buildPostAnalysisPrompt(params: {
  postContent: string;
  likes: number;
  comments: number;
  retweets: number;
  views: number;
}): string {
  return POST_ANALYSIS_PROMPT
    .replace("{{post_content}}", params.postContent)
    .replace("{{likes}}", String(params.likes))
    .replace("{{comments}}", String(params.comments))
    .replace("{{retweets}}", String(params.retweets))
    .replace("{{views}}", String(params.views));
}

export function buildCommentPatternPrompt(topComments: Array<{
  content: string;
  author_handle: string;
  likes: number;
}>): string {
  const formatted = topComments
    .map((c, i) => `${i + 1}. @${c.author_handle}: "${c.content}" (${c.likes} likes)`)
    .join("\n");

  return COMMENT_PATTERN_PROMPT.replace("{{top_comments}}", formatted);
}

export function buildPersonalityLearningPrompt(params: {
  handle: string;
  posts: Array<{ content: string; likes: number }>;
}): string {
  const sample = params.posts
    .slice(0, 20)
    .map((p, i) => `Post ${i + 1} (${p.likes} likes): "${p.content.substring(0, 200)}"`)
    .join("\n\n");

  return PERSONALITY_LEARNING_PROMPT
    .replace("{{handle}}", params.handle)
    .replace("{{post_count}}", String(params.posts.length))
    .replace("{{posts_sample}}", sample);
}

export function buildReplyGenerationPrompt(params: {
  handle: string;
  writingStyle: string;
  topics: string[];
  slangs: string[];
  slangExamples?: Array<{ word: string; context: string }>;
  tone: string;
  postContent: string;
  dominantTone: string;
  commonPhrases: string[];
  emojiTrend: string[];
}): string {
  // Build slang dictionary — use examples if available, fall back to flat list
  const slangDict = params.slangExamples && params.slangExamples.length > 0
    ? params.slangExamples.map((s) => `- "${s.word}" — ${s.context}`).join("\n")
    : params.slangs.length > 0
      ? params.slangs.map((s) => `- "${s}"`).join("\n")
      : "(none identified)";

  return REPLY_GENERATION_PROMPT
    .replace("{{handle}}", params.handle)
    .replace("{{writing_style}}", params.writingStyle)
    .replace("{{topics}}", params.topics.join(", "))
    .replace("{{slang_dictionary}}", slangDict)
    .replace("{{tone}}", params.tone)
    .replace("{{post_content}}", params.postContent)
    .replace("{{dominant_tone}}", params.dominantTone)
    .replace("{{common_phrases}}", params.commonPhrases.join(", "))
    .replace("{{emoji_trend}}", params.emojiTrend.join(", "));
}

export function buildSelfReplyPrompt(params: {
  originalPostContent: string;
  commentAuthor: string;
  commentContent: string;
  commentLikes: number;
  authorTrustScore: number;
  interactionCount: number;
  yourStyle: string;
}): string {
  return SELF_REPLY_GENERATION_PROMPT
    .replace("{{original_post_content}}", params.originalPostContent)
    .replace("{{comment_author}}", params.commentAuthor)
    .replace("{{comment_content}}", params.commentContent)
    .replace("{{comment_likes}}", String(params.commentLikes))
    .replace("{{author_trust_score}}", String(params.authorTrustScore))
    .replace("{{interaction_count}}", String(params.interactionCount))
    .replace("{{your_style}}", params.yourStyle);
}

export function buildPostQualityCheckPrompt(postContent: string): string {
  return POST_QUALITY_CHECK_PROMPT.replace("{{post_content}}", postContent);
}

// ── Self-Reply Execution ──────────────────────────────────────────────────────

const EXECUTE_SELF_REPLY_PROMPT = `You are an AI Agent with browser access. Post a reply to a comment on X.

BROWSER RULE: Keep ONLY ONE tab open at all times.

Step 1: Open {{post_url}} in the browser.
Step 2: Wait for the page to load. Scroll to find the comment with tweet ID {{comment_id}} in the replies section.
Step 3: Click the Reply button on that specific comment.
Step 4: Type the following reply text exactly as provided (do not modify it):
{{reply_content}}
Step 5: Click the Post/Reply button to submit.
Step 6: Confirm the reply was posted successfully.
${OUTPUT_FORMAT_INSTRUCTION}`;

export function buildExecuteReplyPrompt(
  postUrl: string,
  commentId: string,
  replyContent: string,
): string {
  return EXECUTE_SELF_REPLY_PROMPT
    .replace("{{post_url}}", postUrl)
    .replace("{{comment_id}}", commentId)
    .replace("{{reply_content}}", replyContent);
}
