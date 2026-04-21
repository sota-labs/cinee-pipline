import { KOL_CONSTANTS } from '../common/constants/kol.constants';

export interface KolBasic {
  id: string;
  handle: string;
  platform: string;
  profileUrl: string;
}

export interface KolFull extends KolBasic {
  styleSummary: string;
  personalityNotes: string;
  slangVocab: string[];
  writingSamples: string[];
}

/**
 * Prompt for crawling a batch of KOL profiles.
 * OpenClaw navigates each profile, scrapes new posts, calls back to /api/tools/kol/:id/posts/ingest
 */
export function buildKolCrawlPrompt(kols: KolBasic[], apiUrl: string): string {
  const kolList = kols
    .map(
      (k) =>
        `- ID: ${k.id} | Handle: @${k.handle} | Profile: ${k.profileUrl || `https://x.com/${k.handle}`}`,
    )
    .join('\n');

  return `You are an AI Agent with browser access. Your task is to crawl ${kols.length} X.com profiles and extract their recent posts.

BROWSER RULE: Keep ONLY ONE tab open at all times. Close extra tabs before each profile.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KOL PROFILES TO CRAWL:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${kolList}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FOR EACH KOL — REPEAT THESE STEPS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1 — Navigate to the KOL's profile URL.
  - Wait for the page to fully load (timeline visible).

STEP 2 — Scrape up to 10 recent posts:
  - Find top-level post elements: [data-testid="cellInnerDiv"] article
  - For each post, extract:
    * post_url: the full URL (https://x.com/handle/status/ID)
    * external_post_id: the numeric ID from the URL
    * content: text from [data-testid="tweetText"]
    * likes: number from [data-testid="like"] aria-label (parse integer)
    * comments: number from [data-testid="reply"] aria-label
    * shares: number from [data-testid="retweet"] aria-label
    * posted_at: ISO string from <time datetime="...">
  - Scroll once to load more if fewer than 5 posts visible.
  - STOP if a post's posted_at is older than 2 hours ago (we only want fresh posts).

STEP 3 — Save posts to database:
  - Send POST to ${apiUrl}/api/tools/kol/[KOL_ID]/posts/ingest
  - Body: { "posts": [ array of post objects ] }
  - If the response returns writing_samples_needed: true, also collect the post content as writing samples.

STEP 4 — Proceed to the next KOL. Close current tab first.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMPLETION:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
After processing all ${kols.length} KOLs, report:
CRAWL_COMPLETE: Processed [N] KOLs, found [M] new posts total.`;
}

/**
 * Prompt for scraping a KOL's profile to collect writing samples for style learning.
 * OpenClaw scrapes last 50 posts and POSTs to the style-learn callback.
 */
export function buildKolStyleLearnPrompt(kol: KolFull, apiUrl: string): string {
  return `You are an AI Agent with browser access. Your task is to collect writing samples from a KOL's X.com profile for AI style analysis.

BROWSER RULE: Keep ONLY ONE tab open at all times.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TARGET KOL:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Handle: @${kol.handle}
Profile: ${kol.profileUrl || `https://x.com/${kol.handle}`}
KOL ID: ${kol.id}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEPS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1 — Navigate to the KOL's profile URL.

STEP 2 — Collect up to ${KOL_CONSTANTS.MAX_WRITING_SAMPLES} posts:
  - Extract text content only from [data-testid="tweetText"]
  - Skip retweets (posts starting with "RT @")
  - Scroll up to 5 times to load more posts
  - Collect only original posts (not replies)

STEP 3 — Send results to:
  POST ${apiUrl}/api/tools/kol/${kol.id}/style-learn/result
  Body: {
    "writing_samples": [ "post text 1", "post text 2", ... ],
    "style_summary": "[Your brief analysis of writing style]",
    "personality_notes": "[Tone, topics, personality observations]",
    "slang_vocab": [ "word1", "phrase2", ... ]
  }

STEP 4 — Report:
STYLE_LEARN_COMPLETE: Collected [N] writing samples for @${kol.handle}.`;
}

/**
 * Prompt for crawling top 10 comments on a specific KOL post for AI processing.
 */
export function buildKolPostScrapePrompt(
  kolId: string,
  postId: string,
  postUrl: string,
  apiUrl: string,
): string {
  return `You are an AI Agent with browser access. Your task is to scrape the top comments on a specific post.

BROWSER RULE: Keep ONLY ONE tab open at all times.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TARGET POST:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Post URL: ${postUrl}
Post DB ID: ${postId}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEPS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1 — Navigate to: ${postUrl}
  - Wait for post and replies to load.

STEP 2 — Extract the top ${KOL_CONSTANTS.TOP_COMMENT_COUNT} comments sorted by engagement:
  - For each reply article under the post:
    * author_handle: [data-testid="User-Name"] text
    * content: [data-testid="tweetText"] text
    * likes: parse integer from [data-testid="like"] aria-label
    * replies: parse integer from [data-testid="reply"] aria-label
  - Sort by (likes + replies * 2) descending, take top ${KOL_CONSTANTS.TOP_COMMENT_COUNT}.

STEP 3 — POST to ${apiUrl}/api/tools/kol/posts/${postId}/processing/result
  Body: {
    "top_comments": [ { "author_handle", "content", "likes", "replies" }, ... ]
  }

STEP 4 — Report:
POST_SCRAPED: Found [N] comments for post ${postId}.`;
}

/**
 * Prompt to post a generated comment on a KOL's post via OpenClaw.
 */
export function buildPostCommentPrompt(
  postUrl: string,
  commentId: string,
  commentContent: string,
  apiUrl: string,
): string {
  return `You are an AI Agent with browser access. Post a comment on an X.com post and verify it was published.

BROWSER RULE: Keep ONLY ONE tab open at all times.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASK:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STEP 1 — Navigate to: ${postUrl}

STEP 2 — Click the reply button ([data-testid="reply"]).

STEP 3 — Type the following comment with human-like speed (simulate keypress delays):
"""
${commentContent}
"""

STEP 4 — Click the submit button ([data-testid="tweetButtonInline"]).
  - Wait 3 seconds.
  - If an error banner appears, report COMMENT_FAILED: [error message].

STEP 5 — Verify the comment appears in the replies.
  - Find your comment in the thread.
  - Extract the comment URL (https://x.com/*/status/*)

STEP 6 — Report to ${apiUrl}/api/tools/kol/comments/${commentId}/posted:
  POST { "posted_url": "[comment URL]", "success": true }

STEP 7 — Report:
COMMENT_POSTED: ${commentId} at [URL].`;
}

/**
 * Prompt for checking whether a posted comment is visible, collapsed, or flagged.
 */
export function buildVisibilityCheckPrompt(
  commentUrl: string,
  commentId: string,
  checkIndex: number,
  apiUrl: string,
): string {
  return `You are an AI Agent with browser access. Check whether a previously posted comment is still visible on X.com.

BROWSER RULE: Keep ONLY ONE tab open at all times.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASK: Visibility Check ${checkIndex}/${KOL_CONSTANTS.VISIBILITY_CHECK_COUNT}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Comment URL: ${commentUrl}
Comment DB ID: ${commentId}

STEP 1 — Navigate to the parent post (remove the reply anchor if needed — open the original post thread URL).

STEP 2 — Find our comment in the replies:
  - Look for the comment URL's status ID in the thread.
  - Check if the comment is:
    a) VISIBLE: Appears normally in the replies without any "Show more replies" barrier
    b) COLLAPSED: Hidden behind "Show more replies" or "Show" button
    c) FLAGGED: Shows "This post may violate our rules" or similar warning
    d) UNKNOWN: Cannot find the comment at all (may have been deleted or not indexed yet)

STEP 3 — Report result to:
  POST ${apiUrl}/api/tools/kol/comments/${commentId}/visibility-result
  Body: {
    "status": "visible" | "collapsed" | "flagged" | "unknown",
    "check_index": ${checkIndex},
    "notes": "[any relevant observations]"
  }

STEP 4 — Report:
VISIBILITY_CHECK_${checkIndex}: Comment ${commentId} is [STATUS].`;
}
