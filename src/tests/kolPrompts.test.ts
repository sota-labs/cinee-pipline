import { describe, it, expect } from "vitest";
import {
  buildReplyGenerationPromptWithFewShot,
  buildSelfReplyPromptWithFewShot,
} from "../prompts/kolPrompts.js";

const baseKOLParams = {
  handle: "kol_handle",
  postSummary: "AI launch summary",
  trendingTopics: ["AI", "video"],
  topComments: [
    { content: "this is fire", author_handle: "u1", sentiment: "positive" },
  ],
  postContent: "Just shipped an AI video tool",
  dominantTone: "hype",
  commonPhrases: ["ship it", "based"],
  emojiTrend: ["🚀"],
  authorVoiceStyle: "casual, lowercase",
  authorSlangReference: "no cap, lowkey",
  authorStyleFormulas: "open with a hot take",
};

const baseSelfReplyParams = {
  originalPostContent: "Our AI video tool just launched",
  commentAuthor: "commenter1",
  commentContent: "How does it compare to Sora?",
  commentLikes: 5,
  authorTrustScore: 70,
  interactionCount: 0,
  yourStyle: "casual and direct",
};

describe("buildReplyGenerationPromptWithFewShot", () => {
  it("returns base prompt unchanged when fewShot is empty", () => {
    const base = buildReplyGenerationPromptWithFewShot({ ...baseKOLParams, fewShot: [] });
    expect(base).not.toContain("PAST REPLIES");
  });

  it("returns base prompt unchanged when fewShot is undefined", () => {
    const base = buildReplyGenerationPromptWithFewShot({ ...baseKOLParams });
    expect(base).not.toContain("PAST REPLIES");
  });

  it("injects PAST REPLIES block before KOL CONTEXT when fewShot is provided", () => {
    const fewShot = [
      { reply_text: "this is fire, ship it", tone: "supportive" },
      { reply_text: "lowkey based take", tone: "casual" },
      { reply_text: "no cap this slaps", tone: "witty" },
    ];
    const out = buildReplyGenerationPromptWithFewShot({ ...baseKOLParams, fewShot });

    expect(out).toContain("PAST REPLIES (your style — match this register and cadence):");
    expect(out).toContain("[supportive] \"this is fire, ship it\"");
    expect(out).toContain("[casual] \"lowkey based take\"");
    expect(out).toContain("[witty] \"no cap this slaps\"");

    // PAST REPLIES must come BEFORE KOL CONTEXT
    const fewShotPos = out.indexOf("PAST REPLIES");
    const kolContextPos = out.indexOf("KOL CONTEXT");
    expect(fewShotPos).toBeGreaterThan(-1);
    expect(kolContextPos).toBeGreaterThan(fewShotPos);
  });
});

describe("buildSelfReplyPromptWithFewShot", () => {
  it("returns base prompt unchanged when fewShot is empty", () => {
    const base = buildSelfReplyPromptWithFewShot({ ...baseSelfReplyParams, fewShot: [] });
    expect(base).not.toContain("PAST REPLIES");
  });

  it("injects PAST REPLIES block before REPLY GUIDELINES when fewShot is provided", () => {
    const fewShot = [
      { reply_text: "we built it to be more accessible", tone: "visionary" },
      { reply_text: "good q — short answer: yes", tone: "supportive" },
    ];
    const out = buildSelfReplyPromptWithFewShot({ ...baseSelfReplyParams, fewShot });

    expect(out).toContain("PAST REPLIES (your style — match this register and cadence):");
    expect(out).toContain("[visionary] \"we built it to be more accessible\"");

    const fewShotPos = out.indexOf("PAST REPLIES");
    const guidelinesPos = out.indexOf("REPLY GUIDELINES:");
    expect(fewShotPos).toBeGreaterThan(-1);
    expect(guidelinesPos).toBeGreaterThan(fewShotPos);
  });
});
