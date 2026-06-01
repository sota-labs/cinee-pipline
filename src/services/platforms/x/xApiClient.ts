/** X API v2 client — app-only Bearer token, read operations only */
import { settings } from "../../../config/settings.js";
import { KolProfile } from "../../../db/models/KolProfile.js";

export { getStreamRules, addStreamRules, deleteStreamRules, connectFilteredStream } from "./xStreamTypes.js";
export type { IStreamRule, IStreamRuleAdd } from "./xStreamTypes.js";

const X_API_BASE = "https://api.twitter.com/2";

// ── Error types ───────────────────────────────────────────────────────────────

export class XRateLimitError extends Error {
  retryAfter: Date;
  constructor(retryAfter: Date) {
    super(`X API rate limit exceeded. Retry after ${retryAfter.toISOString()}`);
    this.name = "XRateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class XUserNotFoundError extends Error {
  handle: string;
  constructor(handle: string) {
    super(`X user not found: @${handle}`);
    this.name = "XUserNotFoundError";
    this.handle = handle;
  }
}

// ── API response types ────────────────────────────────────────────────────────

export interface XApiTweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
  public_metrics?: {
    like_count: number;
    reply_count: number;
    retweet_count: number;
    impression_count?: number;
    quote_count?: number;
  };
  referenced_tweets?: Array<{ type: "retweeted" | "quoted" | "replied_to"; id: string }>;
  attachments?: { media_keys?: string[] };
  entities?: { urls?: Array<{ expanded_url: string }> };
}

export interface XApiMedia {
  media_key: string;
  type: string;
  url?: string;
}

export interface XApiUser {
  id: string;
  username: string;
}

export interface XApiIncludes {
  media?: XApiMedia[];
  users?: XApiUser[];
}

export interface XApiResponse<T> {
  data?: T;
  includes?: XApiIncludes;
  meta?: { next_token?: string; result_count?: number };
}

// ── Rate limit tracking ───────────────────────────────────────────────────────

interface RateLimitState {
  remaining: number;
  resetAt: Date;
}

const rateLimitMap = new Map<string, RateLimitState>();

function updateRateLimit(endpoint: string, headers: Headers): void {
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (remaining !== null && reset !== null) {
    rateLimitMap.set(endpoint, {
      remaining: parseInt(remaining, 10),
      resetAt: new Date(parseInt(reset, 10) * 1000),
    });
  }
}

function checkRateLimit(endpoint: string): void {
  const state = rateLimitMap.get(endpoint);
  if (state && state.remaining === 0 && state.resetAt > new Date()) {
    throw new XRateLimitError(state.resetAt);
  }
}

// ── Core fetch helper ─────────────────────────────────────────────────────────

class XNotFoundError extends Error {
  status = 404;
  constructor() { super("404 Not Found"); }
}

async function apiFetch<T>(path: string, params: Record<string, string>): Promise<XApiResponse<T>> {
  checkRateLimit(path);
  const url = new URL(`${X_API_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${settings.xApiBearerToken}` },
  });

  updateRateLimit(path, res.headers);

  if (res.status === 429) {
    const resetHeader = res.headers.get("x-ratelimit-reset");
    const retryAfter = resetHeader ? new Date(parseInt(resetHeader, 10) * 1000) : new Date(Date.now() + 15 * 60 * 1000);
    throw new XRateLimitError(retryAfter);
  }

  if (res.status === 404) {
    throw new XNotFoundError();
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<XApiResponse<T>>;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Resolve X handle to numeric user ID. Caches result in KolProfile.x_user_id. */
export async function getUserIdByHandle(handle: string): Promise<string> {
  const cleanHandle = handle.replace(/^@/, "");

  const cached = await KolProfile.findOne({ handle: cleanHandle }).select("x_user_id").lean();
  if (cached?.x_user_id) return cached.x_user_id;

  let res: XApiResponse<XApiUser>;
  try {
    res = await apiFetch<XApiUser>(`/users/by/username/${cleanHandle}`, {
      "user.fields": "id",
    });
  } catch (err) {
    if (err instanceof XNotFoundError) throw new XUserNotFoundError(cleanHandle);
    throw err;
  }

  if (!res.data?.id) throw new XUserNotFoundError(cleanHandle);

  await KolProfile.updateOne({ handle: cleanHandle }, { x_user_id: res.data.id });
  return res.data.id;
}

export interface UserTweetsResult {
  tweets: XApiTweet[];
  includes: XApiIncludes;
}

/** Fetch recent tweets for a user. Pass sinceId to get only newer tweets. */
export async function getUserTweets(userId: string, sinceId?: string): Promise<UserTweetsResult> {
  const params: Record<string, string> = {
    "tweet.fields": "public_metrics,created_at,referenced_tweets,attachments,entities",
    expansions: "attachments.media_keys",
    "media.fields": "url,type",
    max_results: "20",
  };
  if (sinceId) params.since_id = sinceId;

  const res = await apiFetch<XApiTweet[]>(`/users/${userId}/tweets`, params);

  return {
    tweets: res.data ?? [],
    includes: res.includes ?? {},
  };
}

export interface TweetRepliesResult {
  tweets: XApiTweet[];
  includes: XApiIncludes;
}

/** Fetch replies to a tweet by searching conversation_id. */
export async function getTweetReplies(tweetId: string): Promise<TweetRepliesResult> {
  const res = await apiFetch<XApiTweet[]>("/tweets/search/recent", {
    query: `conversation_id:${tweetId} is:reply`,
    "tweet.fields": "public_metrics,created_at,author_id",
    expansions: "author_id",
    "user.fields": "username",
    max_results: "20",
  });

  return {
    tweets: res.data ?? [],
    includes: res.includes ?? {},
  };
}
