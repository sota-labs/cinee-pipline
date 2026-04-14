import { describe, it, expect } from "vitest";
import { getHumanStyleRules } from "../prompts/humanStyleRules.js";

describe("getHumanStyleRules", () => {
  it("returns a non-empty string for all levels", () => {
    for (const level of ["mild", "moderate", "heavy"] as const) {
      const rules = getHumanStyleRules(level);
      expect(typeof rules).toBe("string");
      expect(rules.length).toBeGreaterThan(0);
    }
  });

  it("defaults to moderate when no argument given", () => {
    const withDefault = getHumanStyleRules();
    const withModerate = getHumanStyleRules("moderate");
    expect(withDefault).toBe(withModerate);
  });

  it("mild output does not contain typo instructions", () => {
    const rules = getHumanStyleRules("mild");
    expect(rules).not.toContain("intentional typos");
  });

  it("moderate output contains typo guidance", () => {
    const rules = getHumanStyleRules("moderate");
    expect(rules).toContain("intentional typos");
  });

  it("heavy output contains more typo guidance than moderate", () => {
    const moderate = getHumanStyleRules("moderate");
    const heavy = getHumanStyleRules("heavy");
    expect(heavy.length).toBeGreaterThan(moderate.length);
    expect(heavy).toContain("drop apostrophes");
  });

  it("all levels forbid semicolons and ellipsis", () => {
    for (const level of ["mild", "moderate", "heavy"] as const) {
      const rules = getHumanStyleRules(level);
      expect(rules).toContain("NEVER use semicolons");
      expect(rules).toContain("NEVER use ellipsis");
    }
  });
});
