import { describe, it, expect } from "vitest";
import {
  buildResearchPrompt,
  buildDraftPrompt,
  buildReplyPrompt,
  buildInteractPrompt,
  buildRewritePrompt,
} from "../../prompts/promptBuilder.js";
import { RoleConfig } from "../../config/settings.js";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const cryptoRole: RoleConfig = {
  name: "Crypto Analyst",
  brand: "TokenInsight",
  founderName: "Alice",
  website: "tokeninsight.io",
  companyStage: "scaling",
  persona: "You are a sharp crypto analyst with 5 years in DeFi and on-chain data.",
  tone: "analytical, direct, no-hype",
  topics: ["DeFi", "on-chain analytics", "Ethereum", "Bitcoin", "Layer 2 scaling"],
  communities: ["r/ethereum", "r/defi"],
  engagementKeywords: ["DeFi", "ETH", "L2", "on-chain", "yield farming"],
  searchKeywords: ["Ethereum L2", "DeFi TVL", "on-chain data", "Bitcoin dominance"],
  slangExamples: ["ngmi", "gm", "wen moon", "on-chain data never lies"],
  blacklistedWords: ["revolutionizing", "game-changer", "incredible", "groundbreaking"],
  brandMentionBan: ["Binance"],
  humanStyleLevel: "moderate",
};

const minimalRole: RoleConfig = {
  name: "Test User",
  brand: "TestBrand",
  founderName: "Bob",
  website: "test.com",
  companyStage: "early",
  persona: "A simple persona for testing.",
  tone: "casual",
  topics: ["tech"],
  communities: [],
  engagementKeywords: ["tech"],
};

const API = "http://localhost:3000";

// ── buildResearchPrompt ───────────────────────────────────────────────────────

describe("buildResearchPrompt", () => {
  it("includes searchKeywords in prompt", () => {
    const prompt = buildResearchPrompt(cryptoRole, API);
    expect(prompt).toContain("Ethereum L2");
    expect(prompt).toContain("DeFi TVL");
  });

  it("falls back to engagementKeywords when searchKeywords is not set", () => {
    const prompt = buildResearchPrompt(minimalRole, API);
    expect(prompt).toContain('"tech"');
  });

  it("includes the API URL", () => {
    const prompt = buildResearchPrompt(cryptoRole, API);
    expect(prompt).toContain(API);
  });

  it("does NOT contain AI film references for crypto config", () => {
    const prompt = buildResearchPrompt(cryptoRole, API);
    expect(prompt.toLowerCase()).not.toContain("sora");
    expect(prompt.toLowerCase()).not.toContain("runway");
    expect(prompt.toLowerCase()).not.toContain("kling");
    expect(prompt.toLowerCase()).not.toContain("ai filmmaking");
  });

  it("includes human style rules", () => {
    const prompt = buildResearchPrompt(cryptoRole, API);
    expect(prompt).toContain("semicolons");
    expect(prompt).toContain("ellipsis");
  });

  it("mentions topics", () => {
    const prompt = buildResearchPrompt(cryptoRole, API);
    expect(prompt).toContain("DeFi");
    expect(prompt).toContain("Ethereum");
  });
});

// ── buildDraftPrompt ─────────────────────────────────────────────────────────

describe("buildDraftPrompt", () => {
  it("uses the persona from RoleConfig", () => {
    const prompt = buildDraftPrompt(cryptoRole, API);
    expect(prompt).toContain(cryptoRole.persona);
  });

  it("uses the tone from RoleConfig", () => {
    const prompt = buildDraftPrompt(cryptoRole, API);
    expect(prompt).toContain(cryptoRole.tone);
  });

  it("includes slang examples", () => {
    const prompt = buildDraftPrompt(cryptoRole, API);
    expect(prompt).toContain("ngmi");
    expect(prompt).toContain("gm");
  });

  it("includes blacklisted words", () => {
    const prompt = buildDraftPrompt(cryptoRole, API);
    expect(prompt).toContain("revolutionizing");
    expect(prompt).toContain("game-changer");
  });

  it("bans brand mentions when set", () => {
    const prompt = buildDraftPrompt(cryptoRole, API);
    expect(prompt).toContain("Binance");
  });

  it("does NOT contain AI film references for crypto config", () => {
    const prompt = buildDraftPrompt(cryptoRole, API);
    expect(prompt.toLowerCase()).not.toContain("vfx budget");
    expect(prompt.toLowerCase()).not.toContain("ai filmmaker");
    expect(prompt.toLowerCase()).not.toContain("cinee");
  });

  it("includes the API URL for all endpoints", () => {
    const prompt = buildDraftPrompt(cryptoRole, API);
    expect(prompt).toContain(`${API}/api/tools/db/curation/top`);
    expect(prompt).toContain(`${API}/api/content-review/drafts`);
  });

  it("includes human style rules", () => {
    const prompt = buildDraftPrompt(cryptoRole, API);
    expect(prompt).toContain("semicolons");
  });

  it("uses default blacklisted words when none specified", () => {
    const prompt = buildDraftPrompt(minimalRole, API);
    expect(prompt).toContain("groundbreaking");
  });
});

// ── buildReplyPrompt ─────────────────────────────────────────────────────────

describe("buildReplyPrompt", () => {
  it("mentions role name in prompt", () => {
    const prompt = buildReplyPrompt(cryptoRole, API);
    expect(prompt).toContain("Crypto Analyst");
  });

  it("includes tone", () => {
    const prompt = buildReplyPrompt(cryptoRole, API);
    expect(prompt).toContain(cryptoRole.tone);
  });

  it("includes the replies API endpoint", () => {
    const prompt = buildReplyPrompt(cryptoRole, API);
    expect(prompt).toContain(`${API}/api/tools/db/replies`);
  });

  it("does NOT have AI filmmaker hardcoded language", () => {
    const prompt = buildReplyPrompt(cryptoRole, API);
    expect(prompt.toLowerCase()).not.toContain("ai filmmaker");
    expect(prompt.toLowerCase()).not.toContain("latent space");
  });

  it("has human style rules", () => {
    const prompt = buildReplyPrompt(cryptoRole, API);
    expect(prompt).toContain("ellipsis");
  });
});

// ── buildInteractPrompt ──────────────────────────────────────────────────────

describe("buildInteractPrompt", () => {
  it("uses persona", () => {
    const prompt = buildInteractPrompt(cryptoRole, API);
    expect(prompt).toContain(cryptoRole.persona);
  });

  it("includes relevant topic keywords", () => {
    const prompt = buildInteractPrompt(cryptoRole, API);
    expect(prompt).toMatch(/DeFi|ETH|L2|on-chain/);
  });

  it("includes interact-candidates API endpoint", () => {
    const prompt = buildInteractPrompt(cryptoRole, API);
    expect(prompt).toContain("interact-candidates");
  });

  it("does NOT contain Cinee-specific language for crypto config", () => {
    const prompt = buildInteractPrompt(cryptoRole, API);
    expect(prompt.toLowerCase()).not.toContain("cinee");
    expect(prompt.toLowerCase()).not.toContain("ai filmmaking space");
  });
});

// ── buildRewritePrompt ───────────────────────────────────────────────────────

describe("buildRewritePrompt", () => {
  const content = "Check this Ethereum L2 breakthrough rn";
  const instruction = "Make it punchier";

  it("includes current content and instruction", () => {
    const prompt = buildRewritePrompt(cryptoRole, content, instruction);
    expect(prompt).toContain(content);
    expect(prompt).toContain(instruction);
  });

  it("mentions role name", () => {
    const prompt = buildRewritePrompt(cryptoRole, content, instruction);
    expect(prompt).toContain("Crypto Analyst");
  });

  it("does NOT use Cinee-specific language for crypto config", () => {
    const prompt = buildRewritePrompt(cryptoRole, content, instruction);
    expect(prompt.toLowerCase()).not.toContain("ai filmmaker");
    expect(prompt.toLowerCase()).not.toContain("vfx budget");
  });

  it("includes human style rules", () => {
    const prompt = buildRewritePrompt(cryptoRole, content, instruction);
    expect(prompt).toContain("semicolons");
    expect(prompt).toContain("ellipsis");
  });

  it("includes blacklisted words from config", () => {
    const prompt = buildRewritePrompt(cryptoRole, content, instruction);
    expect(prompt).toContain("revolutionizing");
  });

  it("instructs to output ONLY the rewritten post", () => {
    const prompt = buildRewritePrompt(cryptoRole, content, instruction);
    expect(prompt).toContain("Output ONLY the rewritten post");
  });
});

// ── Cross-config isolation test ───────────────────────────────────────────────

describe("Cross-config isolation", () => {
  const aiFilmKeywords = ["sora", "runway", "kling", "ai filmmaking", "vfx budget", "latent space"];

  it("research prompt for crypto config has no AI film keywords", () => {
    const prompt = buildResearchPrompt(cryptoRole, API).toLowerCase();
    for (const kw of aiFilmKeywords) {
      expect(prompt, `Found AI film keyword "${kw}" in crypto research prompt`).not.toContain(kw);
    }
  });

  it("draft prompt for crypto config has no AI film keywords", () => {
    const prompt = buildDraftPrompt(cryptoRole, API).toLowerCase();
    for (const kw of aiFilmKeywords) {
      expect(prompt, `Found AI film keyword "${kw}" in crypto draft prompt`).not.toContain(kw);
    }
  });

  it("interact prompt for crypto config has no AI film keywords", () => {
    const prompt = buildInteractPrompt(cryptoRole, API).toLowerCase();
    for (const kw of aiFilmKeywords) {
      expect(prompt, `Found AI film keyword "${kw}" in crypto interact prompt`).not.toContain(kw);
    }
  });
});
