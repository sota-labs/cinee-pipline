import { describe, it, expect } from "vitest";
import { shouldSkipBySemantics, AFK_SEMANTIC_BLACKLIST } from "../utils/kolPostSkipRules.js";

describe("shouldSkipBySemantics", () => {
  it("returns false for clean content", () => {
    expect(shouldSkipBySemantics("btc pumping hard today")).toBe(false);
    expect(shouldSkipBySemantics("sol looking cooked ngl")).toBe(false);
  });

  it("matches all blacklist keywords", () => {
    for (const word of AFK_SEMANTIC_BLACKLIST) {
      expect(shouldSkipBySemantics(`post about ${word} happening`)).toBe(true);
    }
  });

  it("is case-insensitive", () => {
    expect(shouldSkipBySemantics("Protocol HACKED for $5m")).toBe(true);
    expect(shouldSkipBySemantics("RIP to the project")).toBe(true);
    expect(shouldSkipBySemantics("Lawsuit filed against team")).toBe(true);
  });

  it("respects word boundaries — no false positives", () => {
    expect(shouldSkipBySemantics("i hacked together a quick script")).toBe(true); // "hacked" is in blacklist
    expect(shouldSkipBySemantics("the investigation led to alpha")).toBe(true);   // "investigation" is blacklisted
    expect(shouldSkipBySemantics("sued me to buy it lol")).toBe(true);            // "sued" is blacklisted
  });

  it("matches multi-word entries", () => {
    expect(shouldSkipBySemantics("founder passed away last night")).toBe(true);
    expect(shouldSkipBySemantics("looks like an exit scam")).toBe(true);
  });

  it("returns false for partial word matches that are not word boundaries", () => {
    // "rugged" is blacklisted but "ruggedized" should not match
    expect(shouldSkipBySemantics("ruggedized hardware")).toBe(false);
  });
});
