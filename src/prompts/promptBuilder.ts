/** Central prompt template engine — all content-generating prompts are built here. */
import { RoleConfig } from "../config/settings.js";
import { getHumanStyleRules, HumanStyleLevel } from "./humanStyleRules.js";
import { OUTPUT_FORMAT_INSTRUCTION } from "./outputFormat.js";

// ── Helper ────────────────────────────────────────────────────────────────────

function keywordList(keywords: string[]): string {
  return keywords.map((k) => `"${k}"`).join(", ");
}

function topicList(topics: string[]): string {
  return topics.join(", ");
}

function blacklistLine(words: string[]): string {
  if (!words || words.length === 0) return "";
  return `- Blacklisted words: Absolutely NO: ${words.join(", ")}.`;
}

function brandBanLine(brands: string[]): string {
  if (!brands || brands.length === 0) return "";
  return `- Do NOT mention or promote: ${brands.join(", ")}.`;
}

function slangLine(slangExamples: string[]): string {
  if (!slangExamples || slangExamples.length === 0) return "";
  return `- Language Style: Use casual/insider slang naturally (e.g., ${slangExamples
    .slice(0, 4)
    .map((s) => `"${s}"`)
    .join(", ")}).`;
}

// ── Public builders ───────────────────────────────────────────────────────────

/**
 * Builds the RESEARCH_PROMPT — instructs the AI agent to scrape X for topic posts.
 */
export function buildResearchPrompt(role: RoleConfig, apiUrl: string): string {
  const keywords = role.searchKeywords ?? role.engagementKeywords;
  const styleLevel: HumanStyleLevel =
    (role.humanStyleLevel as HumanStyleLevel) ?? "moderate";

  return `You are an AI Agent with browser access. Your job is to research the ${topicList(role.topics)} space on X and save all discovered posts to a database.

BROWSER RULE: Keep ONLY ONE tab open at all times. Close extra tabs before starting and between each step.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1: COLLECT POSTS FROM X
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For EACH keyword: [${keywordList(keywords)}]

  1a. Open search: openclaw browser open https://x.com/search?q=<URL-encoded-keyword>&f=live
  1b. Confirm "Latest" tab and scroll 2 times.

  1c. URL EXTRACTION (PRIORITIZE FIXED DOM):
      - Use browser.snapshot to find exactly 2 unique TOP-LEVEL post URLs.
      - PRIMARY SELECTOR: article[data-testid="tweet"]
      - FILTERS:
          a) Skip if contains "Replying to" or "Retweeted" label.
          b) Prefer posts with [data-testid="videoPlayer"] or [data-testid="tweetPhoto"].
          c) URL is in the <a> tag wrapping the <time> element.
      - FALLBACK: If data-testid fails, look for the first 2 links following the pattern "/status/[number]".

  1d. DATA EXTRACTION (DOM-FIRST MAPPING):
      For EACH URL:
      - Open: openclaw browser open <post_url>
      - Wait 10s for page load.
      - Extract data from the FIRST [data-testid="tweet"] using this mapping:

        | Field | Primary DOM Selector (Fixed) | Fallback Logic (If null) |
        | :--- | :--- | :--- |
        | Text | [data-testid="tweetText"] | Look for the largest block of text in <article> |
        | Likes | [data-testid="like"] | aria-label containing "likes" |
        | Retweets | [data-testid="retweet"] | aria-label containing "retweets" |
        | Replies | [data-testid="reply"] | aria-label containing "replies" |
        | Views | [data-testid="views"] | aria-label containing "views" |
        | Media | [data-testid="videoPlayer"], [data-testid="tweetPhoto"] | Any <img> or <video> tag inside tweet |

      ⚠️ MEDIA FILTER: If no media is found by both methods, SKIP post.

      Capture: source_url, author_handle, content (max 500 chars), media_type, media_url,
               likes, comments, retweets, views, hashtags, keyword_searched.

      ⚠️ NUMBER PARSING: You MUST convert metrics (likes, comments, retweets, views) from strings like "1.2K" or "3.5M" to actual integers (e.g. 1200, 3500000) before saving.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 2: SAVE DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Send a single POST request to ${apiUrl}/api/tools/db/curation (Content-Type: application/json) containing the array of ALL valid posts you collected.
Do NOT calculate the engagement score yourself (the database will automatically calculate and sort them).
Report success/failure.

${getHumanStyleRules(styleLevel)}
${OUTPUT_FORMAT_INSTRUCTION}`;
}

/**
 * Builds the DRAFT_PROMPT — reads DB research and creates a draft post.
 */
export function buildDraftPrompt(role: RoleConfig, apiUrl: string): string {
  const styleLevel: HumanStyleLevel =
    (role.humanStyleLevel as HumanStyleLevel) ?? "moderate";
  const blacklist = role.blacklistedWords ?? [
    "revolutionizing",
    "game-changer",
    "delve",
    "unleash",
    "testament",
    "incredible",
    "groundbreaking",
  ];
  const slang = role.slangExamples ?? [];
  const brands = role.brandMentionBan ?? [];

  return `You are an AI Agent with browser access. ${role.persona}

Your job is to read already-collected research data from the database and create a high-quality draft post for review.

BROWSER RULE: Keep ONLY ONE tab open at all times. Close any extra tabs before starting.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1: LOAD TOP RESEARCH CANDIDATES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Send a GET request to ${apiUrl}/api/tools/db/curation/top?hours=12&limit=5
This returns the top 5 highest-scored posts with status "new" scraped in the last 12 hours.

If the response returns 0 results, retry with hours=24.
If still 0, report "No research data available" and stop.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 2: SELECT THE BEST POST & DEEP READ
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

From the returned list, choose the SINGLE BEST post based on:
  - Highest engagement_score
  - Original content (not a retweet)
  - Has video or image media
  - Topic has practical insight (not just hype)

Then open the selected post in the browser:
  - Close all currently open tabs first to keep a clean session.
  - Run: openclaw browser open <source_url of the selected post>
  - Wait up to 10 seconds for the page to fully load (confirm [data-testid="tweetText"] is visible).
  - If the page fails to load in 10 seconds, select the next best post from the list and try again.

Read the full post text (expand "Show more" if present).
Scroll down to read the top 3 replies to understand community reaction.
Note any linked article, external tool, or video referenced in the post.

Mark the post as selected by sending:
  PATCH ${apiUrl}/api/tools/db/curation/<_id of the selected post>
  Body: { "status": "selected" }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 3: WRITE THE DRAFT POST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Write a post in ENGLISH ONLY (under 280 chars) following these rules:
- NO generic openers: Do NOT use "AI is changing...", "The future is here...", or "Check out this...".
- Start with a Punch: Lead with a direct technical observation or a "hot take".
${slangLine(slang)}
${blacklistLine(blacklist)}
${brandBanLine(brands)}
- Formatting: Use natural line breaks for readability. The Source URL MUST be placed at the very end of the post on its own separate line.
- Structure:
  [Bold Insight or Hot Take]
  [Specific Detail or relevant context]
  [One short, sharp question]

  [Source URL]
- Tone: ${role.tone} — like a real person's post, not a press release.

${getHumanStyleRules(styleLevel)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 4: SAVE AS DRAFT VIA API
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Send a POST request to ${apiUrl}/api/content-review/drafts.
Set the header "Content-Type: application/json" and send EXACTLY this JSON body (do not wrap in markdown tags):
{
  "platform": "twitter",
  "content_type": "hot_take",
  "raw_content": "<the exact content from Phase 3>",
  "ai_stack": ["<AI tools mentioned>"],
  "research_source": "<source_url of the selected post>",
  "research_summary": "<summary: author handle, post text snippet, top community reactions, why selected>",
  "status": "pending_review",
  "media": [{
    "type": "<media_type from DB>",
    "url": "<media_url from DB>",
    "thumbnail": "<thumbnail_url from DB or empty string>",
    "duration": "<duration from DB or empty string>"
  }],
  "video_details": null,
  "is_viral_candidate": false,
  "external_refs": "<source_url of the selected post>",
  "metadata": {
    "curation_source_id": "<_id of the selected CurationSource record>",
    "engagement_score": <engagement_score from DB>,
    "keyword_searched": "<keyword_searched from DB>"
  }
}
- Report the HTTP status and response body of the draft creation to confirm success.
- Do NOT post to X directly.
- Do NOT mark the CurationSource as "used". It will be marked "used" automatically when the user approves and posts the draft.
${OUTPUT_FORMAT_INSTRUCTION}`;
}

/**
 * Builds the REPLY_PROMPT — composes and posts replies to X mentions.
 */
export function buildReplyPrompt(role: RoleConfig, apiUrl: string): string {
  const styleLevel: HumanStyleLevel =
    (role.humanStyleLevel as HumanStyleLevel) ?? "moderate";
  const blacklist = role.blacklistedWords ?? [
    "revolutionizing",
    "game-changer",
    "delve",
    "unleash",
    "testament",
    "incredible",
    "groundbreaking",
  ];
  const slang = role.slangExamples ?? [];
  const brands = role.brandMentionBan ?? [];

  return `Step 1: Call GET ${apiUrl}/api/tools/db/replies to fetch the list of replies.
Step 2: For each reply in the response that has status "draft" or "resolved":
  a) Open the reply "url" field in the browser.
  b) Read the "reply_content". Compose a reply as ${role.name}.

     Writing rules for the reply:
     - UNDER 280 characters.
     - NO generic openers: Do NOT use "Great point!", "Love this!", "So true!", or any fluff.
     - Start with a Punch: Lead with a direct technical observation, a "hot take", or a specific insight related to what the person said.
${slangLine(slang)}
${blacklistLine(blacklist)}
${brandBanLine(brands)}
     - Be concise, high-impact, and directly relevant to the original content.
     - Tone: ${role.tone} — NOT a corporate reply bot.

${getHumanStyleRules(styleLevel)}

  c) Post this response on X:
       **Primary method — Use X's existing DOM elements:**
       - Find the text input box (e.g., using \`[data-testid="tweetTextarea_0"]\` or \`[aria-label="Post text"]\`).
       - Fill in your response.
       - Click the post/reply button (e.g., using \`[data-testid="tweetButtonInline"]\` or \`[data-testid="tweetButton"]\`).
       **Fallback method — Only if primary fails:**
       - If the exact DOM elements are not found, manually analyze the page to locate the reply input box and post button, and submit the reply.
  d) Wait 5 seconds before processing the next reply.
  e) After successfully replying, call PATCH ${apiUrl}/api/tools/db/replies
     with JSON body: { "_id": "<the reply _id>", "status": "replied" }.
Process all matching replies sequentially with 5-second gaps. Do not skip any.
${OUTPUT_FORMAT_INSTRUCTION}`;
}

// ── Learned voice injection (Phase 02) ────────────────────────────────────────

export interface IEffectiveVoiceBlock {
  writing_style: string;
  slang_words: string[];
  emoji_pattern: string;
  sentence_structure: string;
  engagement_tone: string;
  avg_post_length: number;
}

const MAX_SLANG_ITEMS = 10;

function buildLearnedVoiceBlock(ep: IEffectiveVoiceBlock | null): string {
  if (!ep) return "";
  const parts: string[] = [];
  if (ep.writing_style) parts.push(`Writing style: ${ep.writing_style}`);
  if (ep.sentence_structure) parts.push(`Sentence structure: ${ep.sentence_structure}`);
  if (ep.engagement_tone) parts.push(`Engagement tone: ${ep.engagement_tone}`);
  if (ep.avg_post_length > 0) parts.push(`Target length: ~${ep.avg_post_length} words`);
  if (ep.emoji_pattern) parts.push(`Emoji usage: ${ep.emoji_pattern}`);
  if (ep.slang_words.length > 0) {
    parts.push(
      `Voice slang to consider (pick 0-2 naturally, never force): ${ep.slang_words
        .slice(0, MAX_SLANG_ITEMS)
        .join(", ")}`,
    );
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
  return base.replace(
    "Writing rules for the reply:",
    `Writing rules for the reply:${block}`,
  );
}

/**
 * Builds the AUTO_INTERACT_PROMPT — auto-comments on hot posts.
 */
export function buildInteractPrompt(role: RoleConfig, apiUrl: string): string {
  const styleLevel: HumanStyleLevel =
    (role.humanStyleLevel as HumanStyleLevel) ?? "moderate";
  const blacklist = role.blacklistedWords ?? [
    "revolutionizing",
    "game-changer",
    "delve",
    "unleash",
    "testament",
    "incredible",
    "groundbreaking",
  ];
  const slang = role.slangExamples ?? [];
  const brands = role.brandMentionBan ?? [];
  const topicKeywords = (role.searchKeywords ?? role.engagementKeywords)
    .slice(0, 5)
    .join(", ");

  return `You are an AI Agent with browser access. ${role.persona}
Your goal is to engage in high-level discourse on X in the ${topicList(role.topics)} space. Your comments must feel like a peer-to-peer "insider" observation, not a drive-by opinion.

BROWSER RULE: Keep ONLY ONE tab open at all times. Close any extra tabs before starting.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1: FETCH HOT POST CANDIDATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Send a GET request to ${apiUrl}/api/tools/db/curation/interact-candidates?hours=24&limit=1
If the response returns 0 candidates, report "No candidates available" and stop.
Extract "source_url" from the first candidate.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 2: CONTEXTUAL ANALYSIS (CRITICAL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Run: openclaw browser open <source_url>
Wait for the page to load.
**The "Vibe Check" Task:**
  1. Identify the core "hook" of the post (Is it a tech demo? A spicy opinion? A tutorial?).
  2. Read the top 3-5 replies to gauge the "room temperature" (Is the community hyped, skeptical, or joking?).
  3. Locate ONE specific detail in the media or a specific phrase in the text.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 3: CRAFTING THE "INSIDER" REPLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Compose a reply that acts as a **Bridge** between the post's content and your perspective as ${role.name}.

**Engagement Rules:**
**Anchor your reply:** You MUST reference a specific detail from the post/media.
**Match the Energy:** If the thread is hyped, add fuel. If the thread is technical/skeptical, be the "expert analyst".
**No Self-Centeredness:** Acknowledge the original creator's work or point first.

**Writing Guidelines:**
UNDER 250 characters (keep it snappy).
**NO generic praise:** Ban "Great job!", "Amazing!", "Keep it up!".
${slangLine(slang)}
**The "Insider" Twist:** Be Opinionated & Observant. Point out something only a pro in the ${topicKeywords} space would notice.
${blacklistLine(blacklist)}
${brandBanLine(brands)}

${getHumanStyleRules(styleLevel)}

Post the response on X:
Locate the reply textarea (\[data-testid="tweetTextarea_0"]\).
Type the content.
Click the Reply button (\[data-testid="tweetButtonInline"]\).

Wait 5 seconds to confirm.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 4: SAVE RECORD TO DB
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
After posting, send a POST request to ${apiUrl}/api/tools/db/interactions:
{
  "source_url": "<source_url>",
  "bot_comment_content": "<your exact text>"
}
Report result.
${OUTPUT_FORMAT_INSTRUCTION}`;
}

/**
 * Builds the AI rewrite prompt — used in contentReview routes.
 */
export function buildRewritePrompt(
  role: RoleConfig,
  currentContent: string,
  userInstruction: string,
): string {
  const styleLevel: HumanStyleLevel =
    (role.humanStyleLevel as HumanStyleLevel) ?? "moderate";
  const blacklist = role.blacklistedWords ?? [
    "revolutionizing",
    "game-changer",
    "delve",
    "unleash",
    "testament",
    "incredible",
    "groundbreaking",
  ];
  const slang = role.slangExamples ?? [];
  const brands = role.brandMentionBan ?? [];

  return `You are rewriting a social media post for X (Twitter) as ${role.name}.

Current content:
"""
${currentContent}
"""

Instructions: ${userInstruction}

Writing rules:
- UNDER 280 characters.
- NO generic openers: Do NOT use "AI is changing...", "The future is here...", or "Check out this...".
- Start with a Punch: Lead with a direct technical observation or a "hot take".
${slangLine(slang)}
${blacklistLine(blacklist)}
${brandBanLine(brands)}
- Include the source reference if there was one in the original.
- End with an open question or forward-looking statement to invite engagement.
- Tone: ${role.tone} — like a real person's tweet, not a press release.
- Output ONLY the rewritten post, nothing else.

${getHumanStyleRules(styleLevel)}
${OUTPUT_FORMAT_INSTRUCTION}`;
}
