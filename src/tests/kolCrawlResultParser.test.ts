import { describe, it, expect } from "vitest";
import {
  parseBatchCrawlResult,
  parseSingleCrawlResult,
} from "../utils/kolCrawlResultParser.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function wrapInDelimiters(json: string): string {
  return `<<<RESPONSE_START>>>\n${json}\n<<<RESPONSE_END>>>`;
}

const validPost = {
  post_url: "https://x.com/foo/status/123",
  content: "Hello world",
  posted_at: "2026-05-07T00:00:00Z",
  likes: 10,
  comments: 5,
  retweets: 2,
  views: 100,
  media_urls: [],
};

// ── parseBatchCrawlResult ─────────────────────────────────────────────────────

describe("parseBatchCrawlResult", () => {
  it("parses valid batch JSON", () => {
    const raw = wrapInDelimiters(
      JSON.stringify({ results: [{ handle: "foo", posts: [validPost] }] })
    );
    const result = parseBatchCrawlResult(raw);
    expect(result).toHaveLength(1);
    expect(result[0].handle).toBe("foo");
    expect(result[0].posts).toHaveLength(1);
    expect(result[0].posts[0].post_url).toBe(validPost.post_url);
  });

  it("normalizes string numbers to integers", () => {
    const raw = wrapInDelimiters(
      JSON.stringify({
        results: [
          {
            handle: "bar",
            posts: [{ ...validPost, likes: "1.2K", views: "3.5M", comments: "50" }],
          },
        ],
      })
    );
    const [{ posts }] = parseBatchCrawlResult(raw);
    expect(posts[0].likes).toBe(1200);
    expect(posts[0].views).toBe(3500000);
    expect(posts[0].comments).toBe(50);
  });

  it("filters out posts with empty content", () => {
    const raw = wrapInDelimiters(
      JSON.stringify({
        results: [
          {
            handle: "baz",
            posts: [
              validPost,
              { ...validPost, content: "" },
              { ...validPost, post_url: "" },
            ],
          },
        ],
      })
    );
    const [{ posts }] = parseBatchCrawlResult(raw);
    expect(posts).toHaveLength(1);
  });

  it("handles partial results (some KOLs missing)", () => {
    const raw = wrapInDelimiters(
      JSON.stringify({
        results: [
          { handle: "alpha", posts: [validPost] },
          { handle: "beta", posts: [] },
        ],
      })
    );
    const result = parseBatchCrawlResult(raw);
    expect(result).toHaveLength(2);
    expect(result[1].posts).toHaveLength(0);
  });

  it("normalizes top_comments", () => {
    const postWithComments = {
      ...validPost,
      top_comments: [
        { content: "great post", author_handle: "alice", likes: "500", reply_count: "3" },
      ],
    };
    const raw = wrapInDelimiters(
      JSON.stringify({ results: [{ handle: "foo", posts: [postWithComments] }] })
    );
    const [{ posts }] = parseBatchCrawlResult(raw);
    expect(posts[0].top_comments).toHaveLength(1);
    expect(posts[0].top_comments![0].likes).toBe(500);
    expect(posts[0].top_comments![0].reply_count).toBe(3);
  });

  it("filters top_comments with empty content", () => {
    const postWithComments = {
      ...validPost,
      top_comments: [
        { content: "", author_handle: "alice", likes: 5, reply_count: 1 },
        { content: "valid comment", author_handle: "bob", likes: 2, reply_count: 0 },
      ],
    };
    const raw = wrapInDelimiters(
      JSON.stringify({ results: [{ handle: "foo", posts: [postWithComments] }] })
    );
    const [{ posts }] = parseBatchCrawlResult(raw);
    expect(posts[0].top_comments).toHaveLength(1);
    expect(posts[0].top_comments![0].author_handle).toBe("bob");
  });

  it("throws on invalid JSON", () => {
    const raw = wrapInDelimiters("not json {{{");
    expect(() => parseBatchCrawlResult(raw)).toThrow("[KolCrawlParser] Invalid JSON");
  });

  it("throws when results key is missing", () => {
    const raw = wrapInDelimiters(JSON.stringify({ data: [] }));
    expect(() => parseBatchCrawlResult(raw)).toThrow("[KolCrawlParser] Expected {results:");
  });

  it("works without RESPONSE delimiters (falls back to raw text)", () => {
    const raw = JSON.stringify({ results: [{ handle: "foo", posts: [validPost] }] });
    const result = parseBatchCrawlResult(raw);
    expect(result[0].handle).toBe("foo");
  });
});

// ── parseSingleCrawlResult ────────────────────────────────────────────────────

describe("parseSingleCrawlResult", () => {
  it("parses valid single result JSON", () => {
    const raw = wrapInDelimiters(JSON.stringify({ posts: [validPost] }));
    const posts = parseSingleCrawlResult(raw);
    expect(posts).toHaveLength(1);
    expect(posts[0].content).toBe("Hello world");
  });

  it("truncates content to 500 chars", () => {
    const longContent = "a".repeat(600);
    const raw = wrapInDelimiters(
      JSON.stringify({ posts: [{ ...validPost, content: longContent }] })
    );
    const [post] = parseSingleCrawlResult(raw);
    expect(post.content.length).toBe(500);
  });

  it("returns empty array when posts is empty", () => {
    const raw = wrapInDelimiters(JSON.stringify({ posts: [] }));
    expect(parseSingleCrawlResult(raw)).toHaveLength(0);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseSingleCrawlResult("bad json")).toThrow("[KolCrawlParser] Invalid JSON");
  });

  it("throws when posts key is missing", () => {
    const raw = wrapInDelimiters(JSON.stringify({ results: [] }));
    expect(() => parseSingleCrawlResult(raw)).toThrow("[KolCrawlParser] Expected {posts:");
  });
});
