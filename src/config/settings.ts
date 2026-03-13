/** Configuration settings for the pipeline. */
import dotenv from "dotenv";
dotenv.config();

export interface LLMConfig {
  brainModel: string;
  executionModel: string;
  communityModel: string;
}

export interface RoleConfig {
  name: string;
  brand: string;
  founderName: string;
  website: string;
  companyStage: string;
  persona: string;
  tone: string;
  topics: string[];
  personalTopics: string[];
  communities: string[];
  engagementKeywords: string[];
}

export interface TwitterConfig {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
  bearerToken: string;
}

export interface RedditConfig {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

export interface Settings {
  llm: LLMConfig;
  role: RoleConfig;
  twitter: TwitterConfig;
  reddit: RedditConfig;
  redisUrl: string;
  sqliteDbPath: string;
  anthropicApiKey: string;
  googleApiKey: string;
  openaiApiKey: string;
  pythonServiceUrl: string;
  port: number;
}

export const settings: Settings = {
  llm: {
    brainModel: "claude-3-opus-20240229",
    executionModel: "gemini-2.5-pro",
    communityModel: "llama-3.1-70b-instruct",
  },
  role: {
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
      "building Cinee", "AI filmmaking future", "creator economy",
      "startup journey", "Sora", "Kling", "Runway", "AI video generation",
      "creator monetization", "platform building", "founder life",
      "AI film hosting", "YouTube algorithm challenges", "Stable Diffusion video",
    ],
    personalTopics: [
      "lessons from building a startup",
      "conversations with AI filmmakers",
      "product decisions and why we made them",
      "the future I see for AI cinema",
      "what I learned this week",
    ],
    communities: [
      "r/aivideo", "r/sora", "r/runwayml", "r/StableDiffusion", "r/filmmaking",
    ],
    engagementKeywords: [
      "Sora", "Kling", "Runway", "AI film", "AI video", "generative video",
      "AI filmmaker", "AI content creator",
    ],
  },
  twitter: {
    apiKey: process.env.TWITTER_API_KEY || "",
    apiSecret: process.env.TWITTER_API_SECRET || "",
    accessToken: process.env.TWITTER_ACCESS_TOKEN || "",
    accessSecret: process.env.TWITTER_ACCESS_SECRET || "",
    bearerToken: process.env.TWITTER_BEARER_TOKEN || "",
  },
  reddit: {
    clientId: process.env.REDDIT_CLIENT_ID || "",
    clientSecret: process.env.REDDIT_CLIENT_SECRET || "",
    username: process.env.REDDIT_USERNAME || "",
    password: process.env.REDDIT_PASSWORD || "",
  },
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379/0",
  sqliteDbPath: process.env.SQLITE_DB_PATH || "pipeline.db",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  googleApiKey: process.env.GOOGLE_API_KEY || "",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  pythonServiceUrl: process.env.PYTHON_SERVICE_URL || "http://localhost:8000",
  port: parseInt(process.env.PORT || "3000", 10),
};
