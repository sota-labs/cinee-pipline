import { describe, it, expect } from "vitest";
import { computeEditRatio } from "../services/replyEvalService.js";
import { createHash } from "node:crypto";

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

describe("replyEval helpers", () => {
  describe("computeEditRatio (Jaccard distance)", () => {
    it("returns 0 for identical text", () => {
      expect(computeEditRatio("a b c", "a b c")).toBe(0);
    });

    it("returns 1 for completely disjoint text", () => {
      expect(computeEditRatio("a b c", "x y z")).toBe(1);
    });

    it("returns small value for partially overlapping text", () => {
      // intersection = {a, b, c} = 3, union = {a, b, c, d} = 4
      // ratio = 1 - 3/4 = 0.25
      expect(computeEditRatio("a b c", "a b c d")).toBeCloseTo(0.25, 5);
    });

    it("returns 1 for empty original when edited is non-empty", () => {
      expect(computeEditRatio("", "anything")).toBe(1);
    });

    it("returns 0 for two empty strings", () => {
      expect(computeEditRatio("", "")).toBe(0);
    });

    it("is case-insensitive", () => {
      expect(computeEditRatio("Hello World", "hello world")).toBe(0);
    });
  });

  describe("hashPrompt", () => {
    it("returns 16 hex characters", () => {
      const hash = hashPrompt("test prompt");
      expect(hash).toHaveLength(16);
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });

    it("is deterministic", () => {
      expect(hashPrompt("same input")).toBe(hashPrompt("same input"));
    });

    it("differs for different inputs", () => {
      expect(hashPrompt("input a")).not.toBe(hashPrompt("input b"));
    });
  });
});
