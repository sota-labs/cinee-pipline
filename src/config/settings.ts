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
}

export interface Settings {
  role: RoleConfig;
  mongoUri: string;
  redisUrl: string;
  publicApiUrl: string;
  port: number;
  cineeTelegramBotToken: string;
  telegramChatId: string;
  telegramWebhookUrl: string;
  openClawAgent: string;
  xUsername: string;
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
};

export const settings: Settings = {
  role: loadRoleConfig(),
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/cinee_pipeline",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379/0",
  publicApiUrl: process.env.PUBLIC_API_URL || "http://localhost:3000",
  port: parseInt(process.env.PORT || "3000", 10),
  cineeTelegramBotToken: process.env.CINEE_TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  telegramWebhookUrl: process.env.TELEGRAM_WEBHOOK_URL || "",
  openClawAgent: process.env.OPENCLAW_AGENT || "main",
  xUsername: process.env.X_USERNAME || "",
};
