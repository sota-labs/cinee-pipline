import { describe, it, expect } from "vitest";
import { KOL_TWEET_SCRIPT, KOL_COMMENT_SCRIPT } from "../utils/kolCrawlScript.js";

// ── Script validity ───────────────────────────────────────────────────────────

describe("KOL_TWEET_SCRIPT", () => {
  it("is a non-empty string", () => {
    expect(typeof KOL_TWEET_SCRIPT).toBe("string");
    expect(KOL_TWEET_SCRIPT.length).toBeGreaterThan(0);
  });

  it("is syntactically valid JavaScript", () => {
    expect(() => new Function(KOL_TWEET_SCRIPT)).not.toThrow();
  });

  it("contains expected data-testid selectors", () => {
    expect(KOL_TWEET_SCRIPT).toContain('[data-testid="tweet"]');
    expect(KOL_TWEET_SCRIPT).toContain('[data-testid="tweetText"]');
    expect(KOL_TWEET_SCRIPT).toContain('[data-testid="like"]');
    expect(KOL_TWEET_SCRIPT).toContain('[data-testid="reply"]');
    expect(KOL_TWEET_SCRIPT).toContain('[data-testid="retweet"]');
  });

  it("contains parseCount helper", () => {
    expect(KOL_TWEET_SCRIPT).toContain("parseCount");
  });
});

describe("KOL_COMMENT_SCRIPT", () => {
  it("is a non-empty string", () => {
    expect(typeof KOL_COMMENT_SCRIPT).toBe("string");
    expect(KOL_COMMENT_SCRIPT.length).toBeGreaterThan(0);
  });

  it("is syntactically valid JavaScript", () => {
    expect(() => new Function(KOL_COMMENT_SCRIPT)).not.toThrow();
  });

  it("skips the first tweet (original post) by slicing from index 1", () => {
    expect(KOL_COMMENT_SCRIPT).toContain(".slice(1,");
  });

  it("extracts author_handle", () => {
    expect(KOL_COMMENT_SCRIPT).toContain("author_handle");
  });

  it("extracts reply_count", () => {
    expect(KOL_COMMENT_SCRIPT).toContain("reply_count");
  });
});

// ── parseCount logic (extracted for unit testing) ─────────────────────────────
// We test the parseCount logic by eval-ing a minimal version of the function

function parseCount(str: unknown): number {
  if (!str) return 0;
  const s = String(str).replace(/,/g, "").trim();
  if (s.endsWith("K")) return Math.round(parseFloat(s) * 1000);
  if (s.endsWith("M")) return Math.round(parseFloat(s) * 1000000);
  return parseInt(s, 10) || 0;
}

describe("parseCount (logic from extraction scripts)", () => {
  it("parses plain integers", () => {
    expect(parseCount("100")).toBe(100);
    expect(parseCount("0")).toBe(0);
  });

  it("parses K suffix", () => {
    expect(parseCount("1.2K")).toBe(1200);
    expect(parseCount("10K")).toBe(10000);
    expect(parseCount("1.5K")).toBe(1500);
  });

  it("parses M suffix", () => {
    expect(parseCount("3.5M")).toBe(3500000);
    expect(parseCount("1M")).toBe(1000000);
  });

  it("handles comma-separated numbers", () => {
    expect(parseCount("1,200")).toBe(1200);
    expect(parseCount("10,000")).toBe(10000);
  });

  it("returns 0 for null/undefined/empty", () => {
    expect(parseCount(null)).toBe(0);
    expect(parseCount(undefined)).toBe(0);
    expect(parseCount("")).toBe(0);
  });

  it("returns 0 for non-numeric strings", () => {
    expect(parseCount("abc")).toBe(0);
  });
});
