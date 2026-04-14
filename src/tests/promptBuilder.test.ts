import { describe, it, expect } from "vitest";
import {
  buildResearchPrompt,
  buildDraftPrompt,
  buildReplyPrompt,
  buildInteractPrompt,
  buildRewritePrompt,
} from "../prompts/promptBuilder.js";
import type { RoleConfig } from "../config/settings.js";

const mockRole: RoleConfig = {
  name: "Test CEO",
  brand: "TestBrand",
  founderName: "Alice",
  website: "test.com",
  companyStage: "building",
  persona: "You are a test persona.",
  tone: "casual, direct",
  topics: ["AI video", "generative media"],
  communities: ["r/aivideo"],
  engagementKeywords: ["Sora", "Runway"],
  searchKeywords: ["AI video", "Runway Gen-3"],
  slangExamples: ["no cap", "lowkey fire"],
  blacklistedWords: ["revolutionary", "synergy"],
  brandMentionBan: ["CompetitorX"],
  humanStyleLevel: "moderate",
};

const API_URL = "http://localhost:3000";

describe("buildResearchPrompt", () => {
  it("returns a string containing the API URL", () => {
    const prompt = buildResearchPrompt(mockRole, API_URL);
    expect(prompt).toContain(API_URL);
  });

  it("includes search keywords from role", () => {
    const prompt = buildResearchPrompt(mockRole, API_URL);
    expect(prompt).toContain("AI video");
    expect(prompt).toContain("Runway Gen-3");
  });

  it("falls back to engagementKeywords when searchKeywords absent", () => {
    const roleNoSearch: RoleConfig = { ...mockRole, searchKeywords: undefined };
    const prompt = buildResearchPrompt(roleNoSearch, API_URL);
    expect(prompt).toContain("Sora");
    expect(prompt).toContain("Runway");
  });

  it("contains PHASE 1 and PHASE 2 sections", () => {
    const prompt = buildResearchPrompt(mockRole, API_URL);
    expect(prompt).toContain("PHASE 1");
    expect(prompt).toContain("PHASE 2");
  });
});

describe("buildDraftPrompt", () => {
  it("returns a string containing the API URL", () => {
    const prompt = buildDraftPrompt(mockRole, API_URL);
    expect(prompt).toContain(API_URL);
  });

  it("includes blacklisted words", () => {
    const prompt = buildDraftPrompt(mockRole, API_URL);
    expect(prompt).toContain("revolutionary");
    expect(prompt).toContain("synergy");
  });

  it("includes brand mention ban", () => {
    const prompt = buildDraftPrompt(mockRole, API_URL);
    expect(prompt).toContain("CompetitorX");
  });

  it("includes persona from role", () => {
    const prompt = buildDraftPrompt(mockRole, API_URL);
    expect(prompt).toContain("You are a test persona.");
  });

  it("does NOT instruct to post to X directly", () => {
    const prompt = buildDraftPrompt(mockRole, API_URL);
    expect(prompt).toContain("Do NOT post to X directly");
  });
});

describe("buildReplyPrompt", () => {
  it("returns a string containing the API URL", () => {
    const prompt = buildReplyPrompt(mockRole, API_URL);
    expect(prompt).toContain(API_URL);
  });

  it("includes instructions to fetch replies", () => {
    const prompt = buildReplyPrompt(mockRole, API_URL);
    expect(prompt).toContain("/api/tools/db/replies");
  });

  it("under 280 chars rule is present", () => {
    const prompt = buildReplyPrompt(mockRole, API_URL);
    expect(prompt).toContain("280 characters");
  });
});

describe("buildInteractPrompt", () => {
  it("returns a string containing the API URL", () => {
    const prompt = buildInteractPrompt(mockRole, API_URL);
    expect(prompt).toContain(API_URL);
  });

  it("includes interact-candidates endpoint", () => {
    const prompt = buildInteractPrompt(mockRole, API_URL);
    expect(prompt).toContain("interact-candidates");
  });

  it("includes role name in reply crafting instructions", () => {
    const prompt = buildInteractPrompt(mockRole, API_URL);
    expect(prompt).toContain("Test CEO");
  });
});

describe("buildRewritePrompt", () => {
  const currentContent = "Old tweet content here";
  const instruction = "Make it punchier";

  it("includes current content in the output", () => {
    const prompt = buildRewritePrompt(mockRole, currentContent, instruction);
    expect(prompt).toContain(currentContent);
  });

  it("includes the user instruction", () => {
    const prompt = buildRewritePrompt(mockRole, currentContent, instruction);
    expect(prompt).toContain(instruction);
  });

  it("instructs to output ONLY the rewritten post", () => {
    const prompt = buildRewritePrompt(mockRole, currentContent, instruction);
    expect(prompt).toContain("Output ONLY the rewritten post");
  });

  it("includes role name", () => {
    const prompt = buildRewritePrompt(mockRole, currentContent, instruction);
    expect(prompt).toContain("Test CEO");
  });

  it("under 280 chars rule is present", () => {
    const prompt = buildRewritePrompt(mockRole, currentContent, instruction);
    expect(prompt).toContain("280 characters");
  });
});
