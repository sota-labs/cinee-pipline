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
- Extract the notification data directly using these specific child elements:
  - 'reply_content' (text): Extract from \`[data-testid="tweetText"]\` or the primary text block.
  - 'url': Extract from \`a[href]\` links, ideally resolving to the full comment URL (e.g. https://x.com/.../status/...).

**Fallback method — Only if the primary method fails:**
- If the exact DOM elements are not found or X has changed its DOM structure, manually analyze the page HTML to identify repeating list-item patterns containing user avatars, text content, and timestamp links, and extract the 'reply_content' and 'url' yourself.

Scroll the notifications page as needed to ensure no items from the last 24 hours are missed.

Step 2: For each notification found:
1. Make sure you have the extracted 'reply_content' and 'url' (as guided above).
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
  b) Read the "reply_content". Compose a reply as a tech CEO / AI filmmaker.

     Writing rules for the reply:
     - UNDER 280 characters.
     - NO generic openers: Do NOT use "Great point!", "Love this!", "So true!", "AI is changing...", or any fluff.
     - Start with a Punch: Lead with a direct technical observation, a "hot take", or a specific insight related to what the person said.
     - Language Style: Use founder slang (e.g., "RIP my VFX budget", "temporal consistency is finally usable", "vibe", "pre-viz", "POV", "latent space"). Use lowercase where it feels more natural/urgent.
     - Blacklisted words: Absolutely NO: revolutionizing, game-changer, delve, unleash, testament, incredible, groundbreaking.
     - Be concise, high-impact, and directly relevant to the original content.
     - Tone: personal, direct, like a peer in the AI filmmaking space — NOT a corporate reply bot.

  c) Post this response on X:
       **Primary method — Use X's existing DOM elements:**
       - Find the text input box (e.g., using \`[data-testid="tweetTextarea_0"]\` or \`[aria-label="Post text"]\`).
       - Fill in your response.
       - Click the post/reply button (e.g., using \`[data-testid="tweetButtonInline"]\` or \`[data-testid="tweetButton"]\`).
       **Fallback method — Only if primary fails:**
       - If the exact DOM elements are not found, manually analyze the page to locate the reply input box and post button, and submit the reply.
  d) Wait 5 seconds before processing the next reply.
  e) After successfully replying, call PATCH ${API}/api/tools/db/replies
     with JSON body: { "_id": "<the reply _id>", "status": "replied" }.
Process all matching replies sequentially with 5-second gaps. Do not skip any.`;

// ── RESEARCH_PROMPT: Scrape X posts → save to CurationSource DB ─────────────
const RESEARCH_PROMPT = `You are an AI Agent with browser access. Your job is to research the AI filmmaking space on X and save all discovered posts to a database.

BROWSER RULE: Keep ONLY ONE tab open at all times. Close extra tabs before starting and between each step.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1: COLLECT POSTS FROM X
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For EACH keyword: ["Sora", "Runway Gen-3", "Kling AI", "AI Filmmaking", "AI video generation", "generative video", "AI filmmaker"]

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
               likes, comments, retweets, views (numbers only), hashtags, keyword_searched.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 2: SCORE & SAVE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For each post, calculate:
  engagement_score = (likes * 1) + (retweets * 3) + (comments * 2) + (views * 0.01)

1. Sort posts descending by engagement_score.
2. Keep ONLY the top 5 globally.

Send POST to ${API}/api/tools/db/curation (Content-Type: application/json).
Report success/failure.`;

export const DRAFT_PROMPT = `You are an AI Agent with browser access acting as a visionary tech CEO who deeply understands cinema and AI filmmaking.
Your job is to read already-collected research data from the database and create a high-quality draft post for review.

BROWSER RULE: Keep ONLY ONE tab open at all times. Close any extra tabs before starting.

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

Write a post in ENGLISH ONLY (under 280 chars) following these "Anti-AI" rules:
- NO generic openers: Do NOT use "AI is changing...", "The future is here...", or "Check out this...".
- Start with a Punch: Lead with a direct technical observation or a "hot take" on the production workflow.
- Language Style: Use founder slang (e.g., "RIP my VFX budget", "temporal consistency is finally usable", "vibe", "pre-viz", "POV", "latent space"). Use lowercase where it feels more natural/urgent.
- Blacklisted words: Absolutely NO: revolutionizing, game-changer, delve, unleash, testament, incredible, groundbreaking.
- Structure: [Bold Insight] + [Specific Detail/Model Name] + [Source URL] + [One short, sharp question].
- Include the source URL from the selected post
- End with an open question or forward-looking statement to invite engagement
- Do NOT mention Cinee or promote any product.
- Tone: personal, direct, visionary — like a real founder's tweet, not a press release.

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
    description:
      "Scrape X for AI filmmaking posts and save to CurationSource DB (every 6 hours)",
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
