/** TopicConfig — runtime-configurable topic/persona settings stored in MongoDB. */
import { Schema, model, Document } from "mongoose";

export interface ITopicConfig extends Document {
  name: string;
  is_active: boolean;
  /** Human-readable description of this config (e.g., "Crypto trading persona"). */
  description?: string;
  brand: string;
  persona: string;
  tone: string;
  topics: string[];
  communities: string[];
  engagement_keywords: string[];
  /** Keywords specifically used for X search scraping. Falls back to engagement_keywords if empty. */
  search_keywords: string[];
  slang_examples: string[];
  blacklisted_words: string[];
  brand_mention_ban: string[];
  human_style_level: "mild" | "moderate" | "heavy";
  created_at: Date;
  updated_at: Date;
}

const topicConfigSchema = new Schema<ITopicConfig>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    is_active: { type: Boolean, default: false },
    description: { type: String, default: "" },
    brand: { type: String, required: true, default: "" },
    persona: { type: String, required: true, default: "" },
    tone: { type: String, required: true, default: "personal, conversational, authentic" },
    topics: { type: [String], default: [] },
    communities: { type: [String], default: [] },
    engagement_keywords: { type: [String], default: [] },
    search_keywords: { type: [String], default: [] },
    slang_examples: { type: [String], default: [] },
    blacklisted_words: {
      type: [String],
      default: ["revolutionizing", "game-changer", "delve", "unleash", "testament", "incredible", "groundbreaking"],
    },
    brand_mention_ban: { type: [String], default: [] },
    human_style_level: {
      type: String,
      enum: ["mild", "moderate", "heavy"],
      default: "moderate",
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

topicConfigSchema.index({ is_active: 1 });
topicConfigSchema.index({ name: 1 });

export const TopicConfig = model<ITopicConfig>("TopicConfig", topicConfigSchema);
