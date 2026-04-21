/** KolProfile — AI-learned personality profile for Key Opinion Leaders */
import { Schema, model, Document, Types } from "mongoose";

// ── Personality Profile Sub-document ────────────────────────────────────────────

export interface IPersonalityProfile {
  writing_style: string;
  common_topics: string[];
  slang_words: string[];
  emoji_pattern: string;
  sentence_structure: string;
  engagement_tone: string;
  avg_post_length: number;
}

const personalityProfileSchema = new Schema<IPersonalityProfile>(
  {
    writing_style: { type: String, default: "" },
    common_topics: { type: [String], default: [] },
    slang_words: { type: [String], default: [] },
    emoji_pattern: { type: String, default: "" },
    sentence_structure: { type: String, default: "" },
    engagement_tone: { type: String, default: "" },
    avg_post_length: { type: Number, default: 0 },
  },
  { _id: false },
);

// ── Main Interface ────────────────────────────────────────────────────────────

export interface IKolProfile extends Document {
  handle: string;
  display_name: string;
  bio: string;
  follower_count: number;
  following_count: number;
  is_verified: boolean;
  account_age_days: number;

  personality_profile: IPersonalityProfile;

  reputation_score: number;
  avg_likes_per_post: number;
  avg_comments_per_post: number;
  avg_retweets_per_post: number;
  post_frequency: number;

  is_active: boolean;
  last_crawled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const kolProfileSchema = new Schema<IKolProfile>(
  {
    handle: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      set: (v: string) => v.replace(/^@/, ""),
    },
    display_name: { type: String, default: "" },
    bio: { type: String, default: "" },
    follower_count: { type: Number, default: 0, min: 0 },
    following_count: { type: Number, default: 0, min: 0 },
    is_verified: { type: Boolean, default: false },
    account_age_days: { type: Number, default: 0, min: 0 },

    personality_profile: {
      type: personalityProfileSchema,
      default: () => ({}),
    },

    reputation_score: { type: Number, default: 50, min: 0, max: 100 },
    avg_likes_per_post: { type: Number, default: 0, min: 0 },
    avg_comments_per_post: { type: Number, default: 0, min: 0 },
    avg_retweets_per_post: { type: Number, default: 0, min: 0 },
    post_frequency: { type: Number, default: 0, min: 0 },

    is_active: { type: Boolean, default: true },
    last_crawled_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

// ── Indexes ───────────────────────────────────────────────────────────────────

kolProfileSchema.index({ is_active: 1, last_crawled_at: 1 });
kolProfileSchema.index({ reputation_score: -1 });
kolProfileSchema.index({ handle: 1 });

// ── Model ─────────────────────────────────────────────────────────────────────

export const KolProfile = model<IKolProfile>("KolProfile", kolProfileSchema);
