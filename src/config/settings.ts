/** Configuration settings. */
import dotenv from "dotenv";
dotenv.config();

export interface RoleConfig {
  name: string;
  brand: string;
  founderName: string;
  website: string;
  companyStage: string;
  persona: string;
  tone: string;
  topics: string[];
  communities: string[];
  engagementKeywords: string[];
  /** Keywords used for X search scraping (falls back to engagementKeywords if not set). */
  searchKeywords?: string[];
  /** Domain-specific casual phrases injected into writing style rules. */
  slangExamples?: string[];
  /** Words the AI must never use in generated content. */
  blacklistedWords?: string[];
  /** Brand/product names the AI must never mention or promote. */
  brandMentionBan?: string[];
  /** Controls intensity of human-like writing style. Default: "moderate". */
  humanStyleLevel?: "mild" | "moderate" | "heavy";
  /** Author's writing style rules injected into reply generation prompt. */
  authorVoiceStyle?: string;
  /** CT slang glossary (safe-deploy terms only) for reply generation. */
  authorSlangReference?: string;
  /** Content formulas (3-line punchline, single zinger, stat irony, etc.) */
  authorStyleFormulas?: string;
}

export interface Settings {
  role: RoleConfig;
  mongoUri: string;
  redisUrl: string;
  publicApiUrl: string;
  port: number;
  openClawAgent: string;
  openClawCrawlModel: string;
  openClawAnalysisModel: string;
  openClawReplyModel: string;
  xUsername: string;
  xApiBearerToken: string;
}

// ── Role config loader ───────────────────────────────────────────────────────

/**
 * Load role config from an external JSON file if ROLE_CONFIG_PATH is set,
 * otherwise fall back to the built-in default config.
 */
function loadRoleConfig(): RoleConfig {
  const configPath = process.env.ROLE_CONFIG_PATH;
  if (configPath) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("fs");
      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<RoleConfig>;
      return { ...defaultRoleConfig, ...parsed };
    } catch (err) {
      // Non-fatal — fall back to default and log a warning at startup
      console.warn(
        `[settings] Could not load ROLE_CONFIG_PATH "${configPath}": ${(err as Error).message}. Using default config.`,
      );
    }
  }
  return defaultRoleConfig;
}

const defaultRoleConfig: RoleConfig = {
  name: "CEO of Cinee",
  brand: "Cinee",
  founderName: process.env.FOUNDER_NAME || "Founder",
  website: "cinee.com",
  companyStage: "building",
  persona: `You are the CEO and founder of Cinee.com — a platform built specifically
    for AI filmmakers to host, share, and monetize their work. You're a builder who lives and
    breathes this space. You personally use Sora, Kling, Runway, and understand the pain points
    because you've experienced them yourself.

    Your content style is founder-led: you share your journey building Cinee, your vision for
    the future of AI filmmaking, and genuine appreciation for creators in the community. You
    speak from personal experience — making product decisions, talking to creators, seeing the
    problems firsthand.

    You are NOT a brand account. You are a person who happens to be building something for
    this community. Your posts feel like a friend who's deeply passionate about AI films, not
    a corporate marketing team. You celebrate others' work before talking about your own.

    Rules:
    - Never pitch Cinee directly. Let curiosity lead people to check your profile/bio.
    - Share genuine reactions to AI films you discover.
    - Talk about industry problems from a founder's perspective.
    - Be vulnerable about the startup journey when appropriate.
    - Engage in conversations as a peer, not as a brand.`,
  tone: "personal, visionary, authentic, builder-mindset, conversational",
  topics: [
    "building Cinee",
    "AI filmmaking future",
    "creator economy",
    "startup journey",
    "Sora",
    "Kling",
    "Runway",
    "AI video generation",
    "creator monetization",
    "platform building",
    "founder life",
    "AI film hosting",
    "YouTube algorithm challenges",
    "Stable Diffusion video",
  ],
  communities: [
    "r/aivideo",
    "r/sora",
    "r/runwayml",
    "r/StableDiffusion",
    "r/filmmaking",
  ],
  engagementKeywords: [
    "Sora",
    "Kling",
    "Runway",
    "AI film",
    "AI video",
    "generative video",
    "AI filmmaker",
    "AI content creator",
  ],
  searchKeywords: [
    "Sora",
    "Runway Gen-3",
    "Kling AI",
    "AI Filmmaking",
    "AI video generation",
    "generative video",
    "AI filmmaker",
  ],
  slangExamples: [
    "RIP my VFX budget",
    "temporal consistency is finally usable",
    "vibe",
    "pre-viz",
    "POV",
    "latent space",
    "prompt-to-video",
  ],
  blacklistedWords: [
    "revolutionizing",
    "game-changer",
    "delve",
    "unleash",
    "testament",
    "incredible",
    "groundbreaking",
  ],
  brandMentionBan: [],
  humanStyleLevel: "moderate",
  authorVoiceStyle: `lowercase always (except $TICKER and project names when needed for clarity)
period at end of sentence optional, comma optional in casual context
no hashtags ever
max 1 emoji ironic, prefer 0 emoji
sarcasm is primary tool (70%+ posts) — NOT cynicism (cynicism = boring)
no over-apologizing for takes
no "follow me" or "check site" CTAs
no generic "great post!" or "thanks for sharing" responses
5-30 words per reply
earned confidence — based on specific experience/data, not "i'm the smartest"`,
  authorSlangReference: `SAFE-DEPLOY SLANG (pick 0-2 that fit naturally — never force):

Trading vibes: rekt, cooked, jeet, bagholder, ape/aped, fomo, dump, pump, moon, rug, bag, down bad, took an L, roundtrip, printing, nuke, top blast, dyor, hopium, diamond hands, paper hands, +ev, gg, got clapped (positions wipe out)
Status: degen, whale, smart money, anon, chad, gigachad, goated, insider, cabal, shiller
Reactions: based, cringe, cope, ngmi, wagmi, gm, lfg, alpha, ngl, wild ngl, lmfao, swear, slovakia, mid, fire, banger, delulu, ratio'd, glazing, iykyk, fr/fr fr
Abbreviations: tho, tbh, ct, kol, asf, dw, nvm, imo, idk, rn, yk
CT culture: shilling, reply guy, engagement farming, narrative, meta, schizo, schizoposting
Greetings: henlo, fren, wen, mfer

CONTEXT RULES (critical):
- mog = visual/aesthetic only (NOT competence/skill)
- chopped/clapped (adj) = about PEOPLE appearance only (NOT UI/chart)
- got clapped (verb) = positions/traders wipe out ✅
- bussin = food only
- gas = experiential (music/food/vibes) NOT software features
- no cap, bet, rizz, skibidi = NEVER deploy`,
  authorStyleFormulas: `5 CONTENT FORMULAS (adapt to reply context):

1. 3-line punchline: Setup → context → punchline
   e.g. "btc dump 5% / longs got flushed / the cope is louder than the chart"

2. Single-line zinger: 1 sentence, done, no elaboration
   e.g. "every cycle creates a new generation of bagholders"

3. List of 3 absurdities: 3 stacked observations, no conclusion
   e.g. "$10b fdv / 13 daily users / 'we're building'"

4. Stat irony: Stat #1 + Stat #2 (contradicting) + dry observation
   e.g. "73% traders profitable / 80% quit before / selection bias is undefeated"

5. Article hack: Clickbait title → 2-5 word punchline that crushes expectation
   e.g. "how to fix your portfolio in 1 day / you can't."

FOR REPLIES specifically: prefer single-line zinger or 3-line punchline. Add observation or perspective — never just agree.`,
};

export const settings: Settings = {
  role: loadRoleConfig(),
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/cinee_pipeline",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379/0",
  publicApiUrl: process.env.PUBLIC_API_URL || "http://localhost:3000",
  port: parseInt(process.env.PORT || "3000", 10),
  openClawAgent: process.env.OPENCLAW_AGENT || "main",
  openClawCrawlModel:
    process.env.OPENCLAW_CRAWL_MODEL || "openrouter/minimax/minimax-m2.5",
  openClawAnalysisModel:
    process.env.OPENCLAW_ANALYSIS_MODEL ||
    "openrouter/minimax/minimax-m2.5",
  openClawReplyModel:
    process.env.OPENCLAW_REPLY_MODEL ||
    "openrouter/anthropic/claude-sonnet-4.6",
  xUsername: process.env.X_USERNAME || "",
  xApiBearerToken: process.env.X_API_BEARER_TOKEN || "",
};
