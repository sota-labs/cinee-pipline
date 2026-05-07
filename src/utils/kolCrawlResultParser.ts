/** Validate and normalize KOL crawl results from OpenClaw. */
import { extractResponse } from "./extractResponse.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IRawPost {
  post_url: string;
  content: string;
  posted_at: string;
  likes: number;
  comments: number;
  retweets: number;
  views: number;
  media_urls?: string[];
  top_comments?: Array<{
    content: string;
    author_handle: string;
    likes: number;
    reply_count: number;
  }>;
}

export interface IBatchKolResult {
  handle: string;
  posts: IRawPost[];
}

// ── Private helpers ────────────────────────────────────────────────────────────

function toNumber(val: unknown): number {
  if (typeof val === "number") return val;
  if (typeof val !== "string") return 0;
  const s = val.replace(/,/g, "").trim();
  if (s.endsWith("K")) return Math.round(parseFloat(s) * 1000);
  if (s.endsWith("M")) return Math.round(parseFloat(s) * 1000000);
  return parseInt(s, 10) || 0;
}

function normalizePost(raw: Record<string, unknown>): IRawPost {
  const topComments = Array.isArray(raw.top_comments)
    ? (raw.top_comments as Array<Record<string, unknown>>)
        .map((c) => ({
          content: String(c.content || "").slice(0, 300),
          author_handle: String(c.author_handle || ""),
          likes: toNumber(c.likes),
          reply_count: toNumber(c.reply_count),
        }))
        .filter((c) => c.content)
    : [];

  return {
    post_url: String(raw.post_url || ""),
    content: String(raw.content || "").slice(0, 500),
    posted_at: String(raw.posted_at || ""),
    likes: toNumber(raw.likes),
    comments: toNumber(raw.comments),
    retweets: toNumber(raw.retweets),
    views: toNumber(raw.views),
    media_urls: Array.isArray(raw.media_urls)
      ? (raw.media_urls as unknown[]).map(String).filter(Boolean)
      : [],
    ...(topComments.length > 0 ? { top_comments: topComments } : {}),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Parse batch crawl result: {"results": [{handle, posts}]}.
 * Extracts JSON from RESPONSE delimiters, validates shape, normalizes fields.
 * @throws Error if JSON is unparseable or top-level shape is invalid.
 */
export function parseBatchCrawlResult(raw: string): IBatchKolResult[] {
  const jsonStr = extractResponse(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      `[KolCrawlParser] Invalid JSON in batch result: ${jsonStr.slice(0, 200)}`
    );
  }

  const obj = parsed as Record<string, unknown>;
  if (!obj || !Array.isArray(obj.results)) {
    throw new Error(
      `[KolCrawlParser] Expected {results: [...]}, got: ${JSON.stringify(parsed).slice(0, 200)}`
    );
  }

  return (obj.results as Array<Record<string, unknown>>)
    .map((entry) => {
      const handle = String(entry.handle || "");
      const rawPosts = Array.isArray(entry.posts)
        ? (entry.posts as Array<Record<string, unknown>>)
        : [];
      const posts = rawPosts
        .map(normalizePost)
        .filter((p) => p.content && p.post_url);
      return { handle, posts };
    })
    .filter((r) => r.handle);
}

/**
 * Parse single KOL crawl result: {"posts": [...]}.
 * @throws Error if JSON is unparseable or top-level shape is invalid.
 */
export function parseSingleCrawlResult(raw: string): IRawPost[] {
  const jsonStr = extractResponse(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      `[KolCrawlParser] Invalid JSON in single result: ${jsonStr.slice(0, 200)}`
    );
  }

  const obj = parsed as Record<string, unknown>;
  if (!obj || !Array.isArray(obj.posts)) {
    throw new Error(
      `[KolCrawlParser] Expected {posts: [...]}, got: ${JSON.stringify(parsed).slice(0, 200)}`
    );
  }

  return (obj.posts as Array<Record<string, unknown>>)
    .map(normalizePost)
    .filter((p) => p.content && p.post_url);
}
