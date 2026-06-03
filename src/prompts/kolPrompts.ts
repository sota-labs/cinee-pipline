/** KOL Analysis Prompts — AI prompts for post analysis and reply generation */
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
5. Quick safety check: detect spam, controversial content, or hidden/flagged indicators
6. Give a recommendation: "proceed" (safe to reply), "caution" (reply carefully), or "skip" (avoid)

Respond in this exact JSON format:
{
  "summary": "...",
  "sentiment": "positive|negative|neutral",
  "trending_topics": ["topic1", "topic2", "topic3"],
  "virality_score": 75,
  "is_spam": false,
  "is_controversial": false,
  "quality_score": 85,
  "risk_factors": ["none"],
  "recommendation": "proceed"
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

// ── Merged Analysis Prompt ────────────────────────────────────────────────────

export const MERGED_ANALYSIS_PROMPT = `Analyze this social media post and its comments in one pass.

POST CONTENT:
{{post_content}}

ENGAGEMENT METRICS:
- Likes: {{likes}}
- Comments: {{comments}}
- Retweets: {{retweets}}
- Views: {{views}}

TOP COMMENTS:
{{top_comments}}

Your task:
1. Write a concise 2-3 sentence summary of the post
2. Determine the sentiment (positive/negative/neutral)
3. Identify up to 3 trending topics mentioned
4. Calculate a virality score (0-100) based on engagement rate
5. Quick safety check: detect spam or low-quality content
6. Give a quality score (0-100) for reply-worthiness
7. Identify the dominant comment tone (humor/agreement/debate/curiosity/questions)
8. Extract common phrases/slangs from comments
9. Note emoji patterns frequently used in comments
10. Calculate the percentage of comments that are questions

Respond in this exact JSON format:
{
  "summary": "...",
  "sentiment": "positive|negative|neutral",
  "trending_topics": ["topic1", "topic2"],
  "virality_score": 75,
  "is_spam": false,
  "quality_score": 85,
  "dominant_tone": "humor|agreement|debate|curiosity|questions",
  "common_phrases": ["phrase1", "phrase2"],
  "emoji_trend": ["emoji1", "emoji2"],
  "question_ratio": 0.3,
  "successful_reply_types": "short witty responses|detailed explanations|agreement with added value"
}
${OUTPUT_FORMAT_INSTRUCTION}`;

export function buildMergedAnalysisPrompt(params: {
  postContent: string;
  likes: number;
  comments: number;
  retweets: number;
  views: number;
  topComments: Array<{ content: string; author_handle: string; likes: number }>;
}): string {
  const formatted = params.topComments.length > 0
    ? params.topComments
        .map((c, i) => `${i + 1}. @${c.author_handle}: "${c.content}" (${c.likes} likes)`)
        .join("\n")
    : "(no comments)";

  return MERGED_ANALYSIS_PROMPT
    .replace("{{post_content}}", params.postContent)
    .replace("{{likes}}", String(params.likes))
    .replace("{{comments}}", String(params.comments))
    .replace("{{retweets}}", String(params.retweets))
    .replace("{{views}}", String(params.views))
    .replace("{{top_comments}}", formatted);
}

// ── Reply Generation Prompts ─────────────────────────────────────────────────

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
  const slicedComments = params.topComments.slice(0, 5);
  const commentsSample = slicedComments.length > 0
    ? slicedComments
        .map((c, i) => `  ${i + 1}. @${c.author_handle} [${c.sentiment}]: "${c.content}"`)
        .join("\n")
    : "  (no comments yet)";

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

function buildFewShotBlock(
  fewShot: Array<{ reply_text: string; tone: string }>,
): string {
  return (
    "\nPAST REPLIES (your style — match this register and cadence):\n" +
    fewShot
      .map((ex, i) => `  ${i + 1}. [${ex.tone}] "${ex.reply_text}"`)
      .join("\n") +
    "\n"
  );
}

export function buildReplyGenerationPromptWithFewShot(params: {
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
  fewShot?: Array<{ reply_text: string; tone: string }>;
}): string {
  const base = buildReplyGenerationPrompt(params);
  if (!params.fewShot || params.fewShot.length === 0) return base;
  const block = buildFewShotBlock(params.fewShot);
  return base.replace("KOL CONTEXT", `${block}\nKOL CONTEXT`);
}

export function buildSelfReplyPromptWithFewShot(params: {
  originalPostContent: string;
  commentAuthor: string;
  commentContent: string;
  commentLikes: number;
  authorTrustScore: number;
  interactionCount: number;
  yourStyle: string;
  fewShot?: Array<{ reply_text: string; tone: string }>;
}): string {
  const base = buildSelfReplyPrompt(params);
  if (!params.fewShot || params.fewShot.length === 0) return base;
  const block = buildFewShotBlock(params.fewShot);
  return base.replace("REPLY GUIDELINES:", `${block}\nREPLY GUIDELINES:`);
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
