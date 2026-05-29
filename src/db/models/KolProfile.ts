/** KolProfile — Key Opinion Leader profile */
import { Schema, model, Document } from "mongoose";

// ── Main Interface ────────────────────────────────────────────────────────────

export type EKolTier = "S" | "A" | "B" | "C";

export interface IKolProfile extends Document {
  handle: string;
  display_name: string;
  bio: string;
  follower_count: number;
  following_count: number;
  is_verified: boolean;
  account_age_days: number;
  tier: EKolTier;

  reputation_score: number;
  avg_likes_per_post: number;
  avg_comments_per_post: number;
  avg_retweets_per_post: number;
  post_frequency: number;

  is_active: boolean;
  last_crawled_at: Date | null;
  x_user_id?: string;
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
    tier: { type: String, enum: ["S", "A", "B", "C"], default: "B" },

    reputation_score: { type: Number, default: 50, min: 0, max: 100 },
    avg_likes_per_post: { type: Number, default: 0, min: 0 },
    avg_comments_per_post: { type: Number, default: 0, min: 0 },
    avg_retweets_per_post: { type: Number, default: 0, min: 0 },
    post_frequency: { type: Number, default: 0, min: 0 },

    is_active: { type: Boolean, default: true },
    last_crawled_at: { type: Date, default: null },
    x_user_id: { type: String, default: null, index: true, sparse: true },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

// ── Indexes ───────────────────────────────────────────────────────────────────

kolProfileSchema.index({ is_active: 1, last_crawled_at: 1 });
kolProfileSchema.index({ reputation_score: -1 });

// ── Model ─────────────────────────────────────────────────────────────────────

export const KolProfile = model<IKolProfile>("KolProfile", kolProfileSchema);
