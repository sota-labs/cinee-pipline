import { describe, it, expect } from "vitest";
import { getHumanStyleRules } from "../../prompts/humanStyleRules.js";

describe("getHumanStyleRules", () => {
  it("returns a string for all three levels", () => {
    expect(typeof getHumanStyleRules("mild")).toBe("string");
    expect(typeof getHumanStyleRules("moderate")).toBe("string");
    expect(typeof getHumanStyleRules("heavy")).toBe("string");
  });

  it("defaults to moderate when no level given", () => {
    const def = getHumanStyleRules();
    const moderate = getHumanStyleRules("moderate");
    expect(def).toBe(moderate);
  });

  it("bans semicolons in all levels", () => {
    expect(getHumanStyleRules("mild")).toContain("semicolons");
    expect(getHumanStyleRules("moderate")).toContain("semicolons");
    expect(getHumanStyleRules("heavy")).toContain("semicolons");
  });

  it("bans ellipsis in all levels", () => {
    expect(getHumanStyleRules("mild")).toContain("ellipsis");
    expect(getHumanStyleRules("moderate")).toContain("ellipsis");
    expect(getHumanStyleRules("heavy")).toContain("ellipsis");
  });

  it("mentions acronyms in all levels", () => {
    expect(getHumanStyleRules("mild")).toMatch(/lol|ngl|imo|tbh/);
    expect(getHumanStyleRules("moderate")).toMatch(/lol|ngl|imo|tbh/);
    expect(getHumanStyleRules("heavy")).toMatch(/lol|ngl|imo|tbh/);
  });

  it("mild does NOT mention typos", () => {
    expect(getHumanStyleRules("mild")).not.toContain("typo");
  });

  it("moderate mentions intentional typos", () => {
    expect(getHumanStyleRules("moderate")).toContain("typo");
  });

  it("heavy has more content than moderate", () => {
    const heavy = getHumanStyleRules("heavy");
    const moderate = getHumanStyleRules("moderate");
    expect(heavy.length).toBeGreaterThan(moderate.length);
  });

  it("heavy mentions dropped apostrophes", () => {
    expect(getHumanStyleRules("heavy")).toMatch(/apostrophe|dont.*cant/i);
  });
});
