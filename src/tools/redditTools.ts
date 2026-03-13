/** Reddit API Tools — ported from reddit_tools.py using snoowrap. */
import Snoowrap from "snoowrap";
import { settings } from "../config/settings.js";

function getRedditClient(): Snoowrap {
  return new Snoowrap({
    userAgent: `cinee-pipeline:v1.0 (by /u/${settings.reddit.username})`,
    clientId: settings.reddit.clientId,
    clientSecret: settings.reddit.clientSecret,
    username: settings.reddit.username,
    password: settings.reddit.password,
  });
}

export async function getRedditPosts(
  subreddit: string,
  limit = 10,
  sortBy: "hot" | "new" | "top" = "hot"
): Promise<Record<string, unknown>[]> {
  try {
    const client = getRedditClient();
    let posts: any[];

    const sub = client.getSubreddit(subreddit);
    switch (sortBy) {
      case "new":
        posts = await sub.getNew({ limit });
        break;
      case "top":
        posts = await sub.getTop({ limit, time: "week" });
        break;
      default:
        posts = await sub.getHot({ limit });
    }

    return posts.map((p: any) => ({
      id: p.id,
      title: p.title,
      selftext: p.selftext?.slice(0, 500) || "",
      author: p.author?.name || "[deleted]",
      score: p.score,
      num_comments: p.num_comments,
      url: `https://reddit.com${p.permalink}`,
      subreddit: p.subreddit?.display_name || subreddit,
      created_utc: p.created_utc,
    }));
  } catch (e: any) {
    return [{ error: e.message }];
  }
}

export async function searchRedditPosts(
  query: string,
  subreddit?: string,
  limit = 10
): Promise<Record<string, unknown>[]> {
  try {
    const client = getRedditClient();
    let results: any[];

    if (subreddit) {
      results = await (client.getSubreddit(subreddit).search as any)({ query, limit, sort: "relevance", time: "month" });
    } else {
      results = await (client as any).search({ query, limit, sort: "relevance", time: "month" });
    }

    return results.map((p: any) => ({
      id: p.id,
      title: p.title,
      selftext: p.selftext?.slice(0, 500) || "",
      author: p.author?.name || "[deleted]",
      score: p.score,
      num_comments: p.num_comments,
      url: `https://reddit.com${p.permalink}`,
      subreddit: p.subreddit?.display_name || "",
    }));
  } catch (e: any) {
    return [{ error: e.message }];
  }
}

export async function createRedditPost(
  subreddit: string,
  title: string,
  text: string
): Promise<Record<string, unknown>> {
  try {
    const client = getRedditClient();
    const post = await (client.getSubreddit(subreddit) as any).submitSelfpost({ title, text, subredditName: subreddit });
    return { success: true, post_id: post.name, url: post.url };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function replyToRedditPost(
  postId: string,
  text: string
): Promise<Record<string, unknown>> {
  try {
    const client = getRedditClient();
    const submission = client.getSubmission(postId);
    const comment = await (submission as any).reply(text);
    return { success: true, comment_id: comment.name };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function getRedditComments(
  postId: string,
  limit = 20
): Promise<Record<string, unknown>[]> {
  try {
    const client = getRedditClient();
    const submission = client.getSubmission(postId);
    const comments = await submission.comments.fetchMore({ amount: limit });

    return comments.map((c: any) => ({
      id: c.id,
      body: c.body?.slice(0, 500) || "",
      author: c.author?.name || "[deleted]",
      score: c.score,
      created_utc: c.created_utc,
    }));
  } catch (e: any) {
    return [{ error: e.message }];
  }
}

export async function monitorAiFilmSubreddits(): Promise<Record<string, unknown>[]> {
  const subreddits = settings.role.communities.map((s) => s.replace("r/", ""));
  const results: Record<string, unknown>[] = [];

  for (const sub of subreddits) {
    const posts = await getRedditPosts(sub, 5, "new");
    results.push({
      subreddit: sub,
      new_posts: posts,
      post_count: posts.length,
    });
  }

  return results;
}

export async function findDiscussionOpportunities(
  limit = 5
): Promise<Record<string, unknown>[]> {
  const keywords = settings.role.engagementKeywords;
  const results: Record<string, unknown>[] = [];

  for (const keyword of keywords.slice(0, 3)) {
    const posts = await searchRedditPosts(keyword, undefined, 3);
    for (const post of posts) {
      if (!("error" in post) && (post.num_comments as number) > 2) {
        results.push({
          keyword,
          ...post,
          relevance: "high",
        });
      }
    }
    if (results.length >= limit) break;
  }

  return results.slice(0, limit);
}
