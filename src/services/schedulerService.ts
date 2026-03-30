/** Scheduler service — OpenClaw isolated cron job management. */
import { execSync } from "child_process";
import { log } from "../utils/logger.js";
import * as dotenv from "dotenv";
import { settings } from "../config/settings.js";
dotenv.config();

const API = process.env.PUBLIC_API_URL || "http://localhost:3000";

interface CronJob {
  name: string;
  schedule: string;
  message: string;
  description: string;
}

// ── Prompt definitions ───────────────────────────────────────────────────────

const SCRAPE_PROMPT = `Open https://x.com/notifications in the browser.

Step 1: Locate notification items (comments/replies from the last 24 hours)

**Primary method — Use X's existing DOM elements first:**
- Look for notification cells using X's built-in selectors: \`[data-testid="cellInnerDiv"]\`, \`[data-testid="notification"]\`, or \`article\` elements inside the notifications timeline.
- Each notification cell typically contains the commenter's name, the reply text, and a link (anchor tag) to the original post/reply.
- Use these existing DOM nodes to extract the notification data directly.

**Fallback method — Only if the primary method fails:**
- If the above selectors return no results or X has changed its DOM structure, then manually analyze the page DOM to identify notification items by inspecting the rendered HTML tree, looking for repeating list-item patterns that contain user avatars, text content, and timestamp indicators.

Scroll the notifications page as needed to ensure no items from the last 24 hours are missed.

Step 2: For each notification found:
1. Extract the 'reply_content' (text) and 'url' from the DOM node (prefer using \`a[href]\` links within the notification cell for the URL).
2. Evaluate the content of the comment:
   - If the comment is meaningful, constructive, or part of a genuine discussion, set status = "resolved".
   - If the comment is spam, a bot-like promotion, irrelevant gibberish, or just "trash" content, set status = "rejected".
3. Prepare a JSON object for each reply with:
   - reply_content: (the comment text)
   - tone_used: "supportive"
   - status: (either "resolved" or "rejected" based on your evaluation)
   - platform: "x"
   - url: (the full URL of the comment)
   - created_at: (current ISO timestamp)
   - updated_at: (current ISO timestamp)

Step 3: After processing all items, send a single POST request to ${API}/api/tools/db/replies with the final array of these objects.`;

const REPLY_PROMPT = `Step 1: Call GET ${API}/api/tools/db/replies to fetch the list of replies. 
Step 2: For each reply in the response that has status "draft" or "resolved": 
  a) Open the reply "url" field in the browser. 
  b) Read the "reply_content". Compose a new response in the tone of a CEO (professional, visionary, and decisive).
     - MANDATORY: The response must be strictly UNDER 300 characters.
     - Keep it concise, high-impact, and relevant to the original content.
     - Avoid fluff or generic "bot" phrases.
     - Post this CEO-style response on X. 
  c) Wait 5 seconds before processing the next reply. 
  d) After successfully replying, call PATCH ${API}/api/tools/db/replies 
     with JSON body: { "_id": "<the reply _id>", "status": "replied" }. 
Process all matching replies sequentially with 5-second gaps. Do not skip any.`;

// ── RESEARCH_PROMPT: Scrape X posts → save to CurationSource DB ─────────────
const RESEARCH_PROMPT = `You are an AI Agent with browser access. Your job is to research the AI filmmaking space on X and save all discovered posts to a database for later use.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1: COLLECT POSTS FROM X
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For EACH keyword below, execute steps 1a → 1e in order before moving to the next keyword.
Keywords: "Sora", "Runway Gen-3", "Kling AI", "AI Filmmaking", "AI video generation", "generative video", "AI filmmaker"

  1a. Open the search results for this keyword:
      Run: openclaw browser open https://x.com/search?q=<URL-encoded-keyword>&f=live
      Examples:
        openclaw browser open https://x.com/search?q=Sora&f=live

  1b. Wait until the page fully loads. Confirm you are on the "Latest" tab.

  1c. Scroll down 2 times using browser actions to load posts into the DOM.

  1d. URL EXTRACTION (CRITICAL — TOP-LEVEL POSTS ONLY):
      - DO NOT click on <article> elements to open posts.
      - Use browser.snapshot on the current search results page.
      - Parse the snapshot to find URLs of TOP-LEVEL posts ONLY. Follow these rules:
          a) Find each <article> element on the page.
          b) SKIP any article that contains text "Replying to" — those are replies/comments, not original posts.
          c) SKIP any article that contains a "Retweeted" label — those are retweets.
          d) In each remaining (non-reply, non-retweet) article, find the <a> tag that wraps the <time> element. Its href has pattern /[username]/status/[tweet_id]. This is the canonical post URL.
          e) Build the full URL: https://x.com + href value.
      - Extract and store a list of exactly 2 unique TOP-LEVEL post URLs for this keyword.
      - If fewer than 2 top-level posts are found, scroll down once more and repeat.

  1e. DATA EXTRACTION PER POST:
      You have a list of 2 URLs for this keyword. For EACH URL:

      BEFORE opening each post:
      - Close all other browser tabs first to keep a clean session. Keep only one tab open at a time.

      - Run: openclaw browser open <post_url>
      - Start a 10-second timer.
      - Wait for the page to fully load: confirm [data-testid="tweetText"] is present in the DOM before proceeding.
      - If the page has NOT loaded within 10 seconds (no tweetText visible), go back and SKIP this post. Move to the next URL.
      - IMPORTANT: The source_url for this post is ALWAYS the URL you just navigated to (the URL you opened in this step), NOT any link found inside the page. Record it immediately.
      - Take a browser.snapshot.
      - Extract data using X's DOM selectors from the snapshot. Focus on the FIRST/TOP article on the page (that is the original post, not a reply):
          PRIMARY (look inside the FIRST [data-testid="tweet"] on the page only):
            - Post text:       [data-testid="tweetText"] (first match)
            - Like count:      [data-testid="like"] aria-label or inner text
            - Retweet count:   [data-testid="retweet"] aria-label or inner text
            - Reply count:     [data-testid="reply"] aria-label or inner text
            - View count:      [data-testid="views"] or [aria-label*="views"]
            - Video player:    [data-testid="videoPlayer"] src or poster attribute
            - Author handle:   [data-testid="User-Name"] (first match on page)

          FALLBACK (only if primary selectors fail after page fully loaded):
            - Manually inspect the snapshot text for content and metrics.
            - Time limit: spend NO MORE THAN 10 SECONDS on fallback per post. Skip if still no data.

      Capture these fields per post into a JSON object:
        - source_url             : the EXACT URL you navigated to (DO NOT re-extract from page links)
        - author_handle          : @username from [data-testid="User-Name"] (first match)
        - author_follower_count  : follower count (number) if visible, else null
        - content                : full post text from the FIRST tweetText (up to 500 chars)
        - media_type             : "video" | "image" | "gif" | "none"
        - media_url              : direct URL of video/image, else null
        - thumbnail_url          : thumbnail URL if video, else null
        - duration               : video duration in seconds if available, else null
        - likes                  : number (default 0)
        - comments               : reply count (default 0)
        - retweets               : retweet count (default 0)
        - views                  : view count (default 0)
        - hashtags               : array of strings (e.g. ["#Sora", "#AIFilm"])
        - keyword_searched       : the keyword that surfaced this post
        
      - After extracting each post, proceed to the next URL in your list.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 2: CHECK TRENDING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run: openclaw browser open https://x.com/explore/tabs/trending
Take a snapshot and note the names of any AI or filmmaking topics in the trending list.
Iterate through all your collected post JSON objects. Add property "trending_match" = true if any of a post's hashtags appear in the trending list, otherwise false.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 3: CALCULATE SCORE, FILTER & SAVE TO DB
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For each collected post in your JSON array, calculate:
  engagement_score = (likes * 1) + (retweets * 3) + (comments * 2) + (views * 0.01)
  + 20 if author has > 10k followers or is verified
  + 15 if trending_match is true
  Add this calculated score to each post object.

CRITICAL: Sort all post objects descending by engagement_score. Keep ONLY the top 5 highest-scored posts globally across all keywords.

Send a POST request to \${API}/api/tools/db/curation with Content-Type: application/json.
CRITICAL: Ensure the JSON body is a properly formatted and escaped array containing strictly the TOP 5 collected posts. If using a shell execution tool, ensure quotes inside the "content" field do not break the command.

Body format:
[
  {
    "source_url": "<post URL>",
    ... [all fields listed in Phase 1e] ...,
    "engagement_score": <calculated score>
  }
]

Report the HTTP status and response body (number of items upserted) to confirm success.`;

export const DRAFT_PROMPT = `You are an AI Agent with browser access acting as a visionary tech CEO who deeply understands cinema and AI filmmaking.
Your job is to read already-collected research data from the database and create a high-quality draft post for review.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1: LOAD TOP RESEARCH CANDIDATES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Send a GET request to ${API}/api/tools/db/curation/top?hours=12&limit=5
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
  PATCH ${API}/api/tools/db/curation/<_id of the selected post>
  Body: { "status": "selected" }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 3: WRITE THE DRAFT POST (CEO Persona)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Write a post (under 280 characters) with these rules:
- Perspective: CEO & founder who uses these AI tools daily
- Start with a bold, specific insight — NOT a generic opener like "AI is changing everything"
- Reference ONE concrete detail from the research (model name, a creator's result, a capability)
- Include the source URL from the selected post
- End with an open question or forward-looking statement to invite engagement
- Do NOT mention Cinee or promote any product
- Tone: personal, direct, visionary — like a real founder's tweet, not a press release

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 4: SAVE AS DRAFT VIA API
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Send a POST request to ${API}/api/content-review/drafts with Content-Type: application/json:
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
- Do NOT post to X directly. The content will be reviewed via Telegram before posting.
- Do NOT mark the CurationSource as "used". It will be marked "used" automatically when the user approves and posts the draft.`;



// ── Job definitions ─────────────────────────────────────────────────────────

const CRON_JOBS: CronJob[] = [
  {
    name: "scrape_x_notifications",
    schedule: "20 * * * *",
    message: SCRAPE_PROMPT,
    description: "Scrape X notifications and store replies (every hour at :20)",
  },
  {
    name: "reply_x_notifications",
    schedule: "40 * * * *",
    message: REPLY_PROMPT,
    description: "Auto-reply on X and update status (every hour at :40)",
  },
  {
    name: "research_and_collect",
    schedule: "0 */6 * * *",
    message: RESEARCH_PROMPT,
    description: "Scrape X for AI filmmaking posts and save to CurationSource DB (every 6 hours)",
  },
  {
    name: "research_and_draft_morning",
    schedule: "0 9 * * *",
    message: DRAFT_PROMPT,
    description:
      "Read top research from DB and create draft for review (9 AM daily)",
  },
  {
    name: "research_and_draft_evening",
    schedule: "0 21 * * *",
    message: DRAFT_PROMPT,
    description:
      "Read top research from DB and create draft for review (9 PM daily)",
  },
];



// ── Helpers ──────────────────────────────────────────────────────────────────

function runOpenClaw(args: string): string {
  try {
    return execSync(`openclaw ${args}`, {
      encoding: "utf-8",
      timeout: 300_000,
    }).trim();
  } catch (error: any) {
    log.error(`OpenClaw error: ${error.message}`);
    throw error;
  }
}

function buildAddCommand(job: CronJob): string {
  const escapedMessage = job.message.replace(/'/g, "'\\''");
  return `cron add --name "${job.name}" --cron "${job.schedule}" --tz "Asia/Ho_Chi_Minh" --session isolated --message '${escapedMessage}' --no-deliver --description "${job.description}"`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function registerIsolatedJobs(): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];

  for (const job of CRON_JOBS) {
    try {
      const cmd = buildAddCommand(job);
      const output = runOpenClaw(cmd);
      log.info(`Registered: ${job.name} (${job.schedule})`);
      results.push({ name: job.name, status: "registered", output });
    } catch (error: any) {
      log.error(`Failed to register: ${job.name}`);
      results.push({ name: job.name, status: "failed", error: error.message });
    }
  }

  return results;
}

export function listJobs(): string {
  try {
    return runOpenClaw("cron list");
  } catch {
    return "Failed to list jobs";
  }
}

export function removeAllJobs(): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];

  for (const job of CRON_JOBS) {
    try {
      const output = runOpenClaw(`cron rm ${job.name}`);
      results.push({ name: job.name, status: "removed", output });
    } catch (error: any) {
      results.push({ name: job.name, status: "failed", error: error.message });
    }
  }

  return results;
}

export function registerSingleJob(jobName: string): Record<string, unknown> {
  const job = CRON_JOBS.find((j) => j.name === jobName);
  if (!job) {
    return {
      name: jobName,
      status: "not_found",
      error: `Job "${jobName}" not found in definitions`,
    };
  }
  try {
    const cmd = buildAddCommand(job);
    const output = runOpenClaw(cmd);
    log.info(`Registered: ${job.name} (${job.schedule})`);
    return { name: job.name, status: "registered", output };
  } catch (error: any) {
    log.error(`Failed to register: ${job.name}`);
    return { name: job.name, status: "failed", error: error.message };
  }
}

export function removeSingleJob(jobName: string): Record<string, unknown> {
  const job = CRON_JOBS.find((j) => j.name === jobName);
  if (!job) {
    return {
      name: jobName,
      status: "not_found",
      error: `Job "${jobName}" not found in definitions`,
    };
  }
  try {
    const output = runOpenClaw(`cron rm ${job.name}`);
    return { name: job.name, status: "removed", output };
  } catch (error: any) {
    return { name: job.name, status: "failed", error: error.message };
  }
}

export function checkGateway(): boolean {
  try {
    runOpenClaw("health");
    return true;
  } catch {
    return false;
  }
}

export function getJobDefinitions(): CronJob[] {
  return CRON_JOBS;
}
