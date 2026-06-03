import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockReplyFind } = vi.hoisted(() => ({
  mockReplyFind: vi.fn(),
}));

vi.mock("../db/connection.js", () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  disconnectDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/models/Reply.js", () => ({
  Reply: { find: mockReplyFind },
  EReplyStatus: { REPLIED: "replied" },
  EReplyPlatform: { X: "x", REDDIT: "reddit" },
}));

import { findFewShotExamples, extractKeywords } from "../services/replyMemoryService.js";

function makeChain(leanResult: unknown) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(leanResult),
  };
  return chain;
}

beforeEach(() => {
  mockReplyFind.mockReset();
});

describe("replyMemoryService.extractKeywords", () => {
  it("extracts at least 3 keywords from a normal sentence", () => {
    const out = extractKeywords("just shipped a new AI tool for developers");
    const kw = out.match(/"[^"]+"/g) ?? [];
    expect(kw.length).toBeGreaterThanOrEqual(3);
  });

  it("drops stop words like 'the', 'and', 'for'", () => {
    const out = extractKeywords("the and for this that with");
    expect(out.trim()).toBe("");
  });

  it("preserves $TICKER-like tokens", () => {
    const out = extractKeywords("$AAPL earnings are shipping next week");
    expect(out).toContain("\"$aapl\"");
    expect(out).toContain("\"earnings\"");
    expect(out).toContain("\"shipping\"");
  });

  it("deduplicates and limits to 10", () => {
    const words = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
    const out = extractKeywords(words);
    const kw = out.match(/"[^"]+"/g) ?? [];
    expect(kw.length).toBeLessThanOrEqual(10);
    expect(new Set(kw).size).toBe(kw.length);
  });
});

describe("replyMemoryService.findFewShotExamples", () => {
  it("returns [] when no posted replies exist", async () => {
    const empty = makeChain([]);
    mockReplyFind.mockReturnValue(empty);
    const out = await findFewShotExamples({
      contextText: "shipping product launch",
      platform: "x" as never,
    });
    expect(out).toEqual([]);
  });

  it("returns up to top-K distinct examples, most recent first", async () => {
    const candidates = [
      { reply_content: "ship it fast", tone_used: "supportive", author_handle: "u1", parent_post_url: "p1", created_at: new Date("2026-06-03") },
      { reply_content: "ship it faster", tone_used: "supportive", author_handle: "u2", parent_post_url: "p2", created_at: new Date("2026-06-02") },
      { reply_content: "ship it fastest", tone_used: "supportive", author_handle: "u3", parent_post_url: "p3", created_at: new Date("2026-06-01") },
      { reply_content: "ship it fastestest", tone_used: "supportive", author_handle: "u4", parent_post_url: "p4", created_at: new Date("2026-05-31") },
    ];
    const chain = makeChain(candidates);
    mockReplyFind.mockReturnValue(chain);

    const out = await findFewShotExamples({
      contextText: "shipping product launch",
      platform: "x" as never,
      topK: 3,
    });
    expect(out).toHaveLength(3);
    const texts = out.map((e) => e.reply_text);
    expect(new Set(texts).size).toBe(3);
  });

  it("deduplicates by content hash", async () => {
    const candidates = [
      { reply_content: "duplicate reply", tone_used: "supportive", author_handle: "u1", parent_post_url: "p1", created_at: new Date("2026-06-03") },
      { reply_content: "duplicate reply", tone_used: "supportive", author_handle: "u2", parent_post_url: "p2", created_at: new Date("2026-06-02") },
      { reply_content: "unique reply", tone_used: "supportive", author_handle: "u3", parent_post_url: "p3", created_at: new Date("2026-06-01") },
    ];
    const chain = makeChain(candidates);
    mockReplyFind.mockReturnValue(chain);

    const out = await findFewShotExamples({
      contextText: "test",
      platform: "x" as never,
      topK: 3,
    });
    expect(out).toHaveLength(2);
  });

  it("excludes one example per author (max 1 per author_handle)", async () => {
    const candidates = [
      { reply_content: "first by u1", tone_used: "supportive", author_handle: "u1", parent_post_url: "p1", created_at: new Date("2026-06-03") },
      { reply_content: "second by u1", tone_used: "supportive", author_handle: "u1", parent_post_url: "p2", created_at: new Date("2026-06-02") },
      { reply_content: "third by u1", tone_used: "supportive", author_handle: "u1", parent_post_url: "p3", created_at: new Date("2026-06-01") },
      { reply_content: "different author", tone_used: "supportive", author_handle: "u2", parent_post_url: "p4", created_at: new Date("2026-05-30") },
    ];
    const chain = makeChain(candidates);
    mockReplyFind.mockReturnValue(chain);

    const out = await findFewShotExamples({
      contextText: "test",
      platform: "x" as never,
      topK: 3,
    });
    expect(out).toHaveLength(2);
    const authors = new Set(out.map((e) => e.parent_context));
    expect(authors.size).toBe(2);
  });

  it("prefers tone-matched candidates first when tone filter is provided", async () => {
    const candidates = [
      { reply_content: "casual reply", tone_used: "casual", author_handle: "u1", parent_post_url: "p1", created_at: new Date("2026-06-03") },
      { reply_content: "witty reply", tone_used: "witty", author_handle: "u2", parent_post_url: "p2", created_at: new Date("2026-06-02") },
      { reply_content: "witty reply 2", tone_used: "witty", author_handle: "u3", parent_post_url: "p3", created_at: new Date("2026-06-01") },
    ];
    const chain = makeChain(candidates);
    mockReplyFind.mockReturnValue(chain);

    const out = await findFewShotExamples({
      contextText: "test",
      platform: "x" as never,
      tone: "witty",
      topK: 3,
    });
    expect(out[0].tone).toBe("witty");
    expect(out[1].tone).toBe("witty");
    expect(out[2].tone).toBe("casual");
  });

  it("falls back to recent posted replies when BM25 returns 0 hits", async () => {
    // First call (with $text) returns empty
    const emptyChain = makeChain([]);
    // Second call (fallback, no $text) returns recent
    const recentChain = makeChain([
      { reply_content: "fallback recent", tone_used: "supportive", author_handle: "u1", parent_post_url: "p1", created_at: new Date("2026-06-03") },
    ]);
    mockReplyFind
      .mockReturnValueOnce(emptyChain)
      .mockReturnValueOnce(recentChain);

    const out = await findFewShotExamples({
      contextText: "completely unrelated to fallback recent content xyz123",
      platform: "x" as never,
    });
    expect(out).toHaveLength(1);
    expect(out[0].reply_text).toBe("fallback recent");
  });
});
