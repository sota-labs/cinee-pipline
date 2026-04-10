/** Static prompts that do not depend on topic/persona config. */

const API = process.env.PUBLIC_API_URL || "http://localhost:3000";

export const SCRAPE_PROMPT = `Reference Time: Today is ${new Date().toISOString()}.
Target Window: Only items created within the last 24 hours from this Reference Time.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE A: SCRAPE MENTIONS → Save to Replies DB
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 1: Open https://x.com/notifications/mentions in the browser.

Step 2: Locate and Filter Mentions
- Primary selector: [data-testid="cellInnerDiv"] or article.
- **CRITICAL - Time Validation:** For every item, find the <time> element and extract its 'datetime' attribute.
  - If 'datetime' is older than 24 hours from Reference Time, SKIP the item.
  - If you encounter 3 consecutive items older than 24 hours, STOP scrolling and proceed to Step 4.

Step 3: Extract Data (Only for items within the 24h window):
- 'reply_content': Extract text from [data-testid="tweetText"].
- 'url': Find the <a> tag linked to the timestamp or the tweet status to get the full URL (e.g., https://x.com/username/status/...).
- 'actual_timestamp': The value from the 'datetime' attribute of the <time> element.
- 'author_handle': The @username who wrote the mention (found in the tweet header or URL path).

Step 4: Evaluate and Format:
1. Evaluate 'reply_content':
   - status = "resolved" if the comment is a genuine question, constructive feedback, or meaningful discussion.
   - status = "rejected" if it is spam, automated bot promotion, irrelevant gibberish, or offensive "trash" content.
2. Prepare JSON object:
   - reply_content: (the extracted text)
   - tone_used: "supportive"
   - status: (resolved/rejected)
   - platform: "x"
   - url: (the full comment URL)
   - created_at: (use the 'actual_timestamp' extracted from the element)
   - updated_at: ${new Date().toISOString()}

Step 5: Send a single POST request to ${API}/api/tools/db/replies with the final array of objects.
Keep a local list of { author_handle, type: "comment" } for every mention saved — you will use this in Phase B.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE B: DETECT LIKES & RETWEETS → Update Inner Circle Scores
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Step 6: Open https://x.com/notifications (the "All" tab).
Apply the same 24-hour time filter as Phase A.
Scroll until you encounter 3 consecutive items older than 24 hours or reach the end.

Step 7: For each notification item within the time window, detect the type and extract the author:
- LIKE    → notification sentence contains "liked"    → type = "like"
- RETWEET → notification sentence contains "reposted" or "retweeted" → type = "share"
- REPLY / MENTION → already captured in Phase A → type = "comment" (skip here to avoid double-counting)
- Extract author_handle: the @username shown in the notification (first @mention in the text).

Step 8: Combine all interactions from Phase A (comments) and Phase B (likes + shares).
Group by author_handle and sum each type:
  { handle: "@alice", likes: 2, comments: 1, shares: 0 }

Step 9: For each unique handle in the grouped list:
- Skip the entry if likes + comments + shares = 0.
- Send POST ${API}/api/priority-accounts/inc-stats with body:
  {
    "handle": "<author_handle>",
    "likes": <total_likes>,
    "comments": <total_comments>,
    "shares": <total_shares>
  }
- Report total number of inc-stats calls made at the end.`;

export const AUTO_LIKE_PROMPT = `You are an AI Agent with browser access. Your goal is to organically like posts on X from our inner circle and hot industry topics.

BROWSER RULE: Keep ONLY ONE tab open at all times. Close any extra tabs before starting.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1: LIKE HIGH-PRIORITY ACCOUNTS (2-3 posts)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Send a GET request to ${API}/api/priority-accounts?limit=5
2. Pick 2 to 3 accounts from the response.
3. For each selected account (using the "handle"):
   a. Run: openclaw browser open https://x.com/<handle>
   b. Wait for the profile to load.
   c. Scroll down and find the first or second original post (skip pinned posts and retweets).
   d. Locate the Like button ([data-testid="like"]) for that post.
   e. Click the Like button.
   f. Wait 5 seconds to simulate human behavior.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 2: LIKE HOT POSTS (2-3 posts)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Send a GET request to ${API}/api/tools/db/curation/interact-candidates?hours=24&limit=3
2. For each candidate returned:
   a. Run: openclaw browser open <source_url>
   b. Wait for the page to load.
   c. Locate the Like button for the main post ([data-testid="like"]).
   d. Click the Like button.
   e. Wait 5 seconds.

Report the total number of posts liked.`;

export const AUTO_BOOKMARK_PROMPT = `You are an AI Agent with browser access. Your goal is to occasionally bookmark a valuable post on X.

BROWSER RULE: Keep ONLY ONE tab open at all times. Close any extra tabs before starting.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PHASE 1: BOOKMARK A HOT POST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Send a GET request to ${API}/api/tools/db/curation/interact-candidates?hours=48&limit=1
2. Extract the "source_url" from the candidate.
3. Run: openclaw browser open <source_url>
4. Wait for the page to load.
5. Locate the Bookmark button for the main post ([data-testid="bookmark"]).
6. Click the Bookmark button to save it.
7. Wait 5 seconds to confirm.
8. Report the URL of the bookmarked post.`;
