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

const RESEARCH_AND_DRAFT_PROMPT = `You are an AI Agent with browser access acting as a visionary tech CEO who deeply understands cinema and AI filmmaking.
Your goal is to research the AI filmmaking space thoroughly, identify the most impactful trending content, and create a high-quality draft post.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1: DEEP RESEARCH (do not skip any step)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For EACH keyword in this list, execute steps 1a → 1e before moving to the next keyword:
  Keywords: "Sora", "Runway Gen-3", "Kling AI", "AI Filmmaking", "AI video generation", "generative video", "AI filmmaker"

  1a. Open the search page for this keyword:
      Run: openclaw browser open https://x.com/search?q=<URL-encoded-keyword>&f=live
      (Examples:
        openclaw browser open https://x.com/search?q=Sora&f=live
        openclaw browser open https://x.com/search?q=AI%20Filmmaking&f=live
        openclaw browser open https://x.com/search?q=generative%20video&f=live
      )

  1b. Wait for the page to fully load. Make sure you are on the "Latest" tab (most recent posts).

  1c. Scroll down slowly 3 times to load at least 20-30 posts.

  1d. For each post that contains a video or image (target: collect top 5 per keyword), capture:
      - post_url        : full URL (click the post, copy from browser address bar)
      - author_handle   : @username of the poster
      - author_follower_count : number of followers if visible
      - post_text       : full text of the post (up to 500 characters)
      - posted_at       : timestamp of the post (e.g. "2h ago", "Mar 27")
      - media_type      : video | image | gif
      - media_url       : direct URL of the video/image
      - thumbnail_url   : thumbnail if it is a video
      - duration        : video duration if available
      - likes           : number of likes
      - retweets        : number of retweets
      - replies         : number of replies
      - views           : number of views if visible
      - hashtags        : list of hashtags used (e.g. ["#Sora", "#AIFilm"])

  1e. Also note the keyword that surfaced this post.

After collecting posts for all keywords, you should have up to 35 candidate posts total.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 2: TREND ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

2a. Also check what is trending in the AI/tech space:
    Run: openclaw browser open https://x.com/explore/tabs/trending
    Note any AI filmmaking or generative video topics appearing in the trending list.

2b. Score each candidate post using this formula:
    score = (likes * 1) + (retweets * 3) + (replies * 2) + (views * 0.01)
    Add a +20 bonus if the post is from a verified account or has >10k followers.
    Add a +15 bonus if the topic matches a trending hashtag on X right now.

2c. Sort all candidate posts by score descending. Keep the top 5 highest-scored posts.

2d. From those top 5, choose the SINGLE BEST post as the research source, prioritizing:
    - Original content (not just a retweet)
    - Contains actual video or image media (not just text)
    - From the last 12 hours if possible
    - Topic has practical insight (not just hype)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 3: DEEP READ THE SELECTED POST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

3a. Open the selected post in full:
    Run: openclaw browser open <selected-post-URL>

3b. Read the full post text (including any "Show more" expanded content).

3c. Scroll down to read the top 3 replies/comments to understand community reaction.

3d. Note any linked article, external video, or tool mentioned in the post.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 4: CONTENT CREATION (CEO Persona)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Write a post (under 280 characters) following these rules:
- Perspective: CEO & founder who uses these AI tools daily
- Start with a hook — a bold, specific insight (not generic "AI is changing everything")
- Reference ONE concrete thing from the research (a model name, a capability, a creator's result)
- Include the source URL
- End with an open question or a forward-looking statement to invite engagement
- Do NOT mention Cinee or promote any product
- Tone: personal, direct, visionary — like a tweet from a founder, not a press release

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 5: SAVE AS DRAFT VIA API
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Send a POST request to ${API}/api/content-review/drafts with Content-Type: application/json and this JSON body:
{
  "platform": "twitter",
  "content_type": "hot_take",
  "raw_content": "<the exact content from Phase 4>",
  "ai_stack": ["<AI tools mentioned, e.g. Sora, Runway Gen-3, Kling>"],
  "research_source": "<the selected post URL>",
  "research_summary": "<detailed summary: author @handle, post text, top community reactions, engagement score, why this post was selected>",
  "status": "pending_review",
  "media": [{
    "type": "<video or image or gif>",
    "url": "<media URL>",
    "thumbnail": "<thumbnail URL if video, otherwise empty string>",
    "duration": "<duration if video, otherwise empty string>"
  }],
  "video_details": null,
  "is_viral_candidate": false,
  "external_refs": "<the selected post URL>",
  "metadata": {
    "keyword_searched": "<the keyword that surfaced this post>",
    "engagement_score": <calculated score from Phase 2b>,
    "top_candidates_count": <total number of posts collected before selection>,
    "trending_topic_match": <true if topic was trending on X, false otherwise>
  }
}
- Report the HTTP status and response body to confirm the draft was created.
- Do NOT post to X directly. The content will be reviewed via Telegram before posting.`;



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
    name: "research_and_draft_morning",
    schedule: "0 9 * * *",
    message: RESEARCH_AND_DRAFT_PROMPT,
    description:
      "Research AI filmmaking trends and create draft for review (9 AM daily)",
  },
  {
    name: "research_and_draft_evening",
    schedule: "0 21 * * *",
    message: RESEARCH_AND_DRAFT_PROMPT,
    description:
      "Research AI filmmaking trends and create draft for review (9 PM daily)",
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
