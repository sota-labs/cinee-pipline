import { describe, it, expect } from "vitest";
import {
  buildResearchPrompt,
  buildDraftPrompt,
  buildReplyPrompt,
  buildInteractPrompt,
  buildRewritePrompt,
  buildReplyPromptWithProfile,
  type IEffectiveVoiceBlock,
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

describe("buildReplyPromptWithProfile", () => {
  const fullProfile: IEffectiveVoiceBlock = {
    writing_style: "punchy and lowercase",
    slang_words: ["vibe", "fire", "lowkey"],
    emoji_pattern: "sparingly, mostly 🎬",
    sentence_structure: "short fragments, 1-2 clauses",
    engagement_tone: "playful, irreverent",
    avg_post_length: 42,
  };

  it("returns identical string when profile is null", () => {
    const base = buildReplyPrompt(mockRole, API_URL);
    const withProfile = buildReplyPromptWithProfile(mockRole, API_URL, null);
    expect(withProfile).toBe(base);
  });

  it("returns identical string when profile fields are all empty", () => {
    const empty: IEffectiveVoiceBlock = {
      writing_style: "",
      slang_words: [],
      emoji_pattern: "",
      sentence_structure: "",
      engagement_tone: "",
      avg_post_length: 0,
    };
    const base = buildReplyPrompt(mockRole, API_URL);
    const withEmpty = buildReplyPromptWithProfile(mockRole, API_URL, empty);
    expect(withEmpty).toBe(base);
  });

  it("includes LEARNED VOICE block when profile has content", () => {
    const prompt = buildReplyPromptWithProfile(mockRole, API_URL, fullProfile);
    expect(prompt).toContain("LEARNED VOICE");
    expect(prompt).toContain("Writing style: punchy and lowercase");
    expect(prompt).toContain("Engagement tone: playful, irreverent");
    expect(prompt).toContain("Target length: ~42 words");
  });

  it("injects block immediately after 'Writing rules for the reply:'", () => {
    const prompt = buildReplyPromptWithProfile(mockRole, API_URL, fullProfile);
    const injectionIdx = prompt.indexOf("Writing rules for the reply:");
    const blockIdx = prompt.indexOf("LEARNED VOICE");
    expect(blockIdx).toBeGreaterThan(injectionIdx);
    const between = prompt.slice(injectionIdx, blockIdx);
    expect(between.length).toBeLessThan(50);
  });

  it("only includes non-empty fields in partial profile", () => {
    const partial: IEffectiveVoiceBlock = {
      writing_style: "minimal, dry",
      slang_words: [],
      emoji_pattern: "",
      sentence_structure: "",
      engagement_tone: "",
      avg_post_length: 0,
    };
    const prompt = buildReplyPromptWithProfile(mockRole, API_URL, partial);
    expect(prompt).toContain("Writing style: minimal, dry");
    expect(prompt).not.toContain("Emoji usage:");
    expect(prompt).not.toContain("Voice slang");
  });

  it("caps slang_words at 10 items", () => {
    const longSlang: IEffectiveVoiceBlock = {
      ...fullProfile,
      slang_words: Array.from({ length: 25 }, (_, i) => `slang${i}`),
    };
    const prompt = buildReplyPromptWithProfile(mockRole, API_URL, longSlang);
    expect(prompt).toContain("slang0");
    expect(prompt).toContain("slang9");
    expect(prompt).not.toContain("slang10");
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
