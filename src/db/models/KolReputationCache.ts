/** KolReputationCache — Cached reputation check for KOLs and comment authors */
import { Schema, model, Document } from "mongoose";

// ── Enums ──────────────────────────────────────────────────────────────────────

export enum EReputationRecommendation {
  PROCEED = "proceed",
  CAUTION = "caution",
  SKIP = "skip",
}

// ── Sub-documents ─────────────────────────────────────────────────────────────

export interface IReputationMetrics {
  account_age_days: number;
  follower_count: number;
  tweet_count: number;
  verified_status: boolean;
  recent_suspension_flags: number;
  spam_score: number;
  bot_probability: number;
  engagement_authenticity: number;
}

const reputationMetricsSchema = new Schema<IReputationMetrics>(
  {
    account_age_days: { type: Number, default: 0 },
    follower_count: { type: Number, default: 0 },
    tweet_count: { type: Number, default: 0 },
    verified_status: { type: Boolean, default: false },
    recent_suspension_flags: { type: Number, default: 0 },
    spam_score: { type: Number, default: 0, min: 0, max: 100 },
    bot_probability: { type: Number, default: 0, min: 0, max: 100 },
    engagement_authenticity: { type: Number, default: 100, min: 0, max: 100 },
  },
  { _id: false },
);

// ── Main Interface ────────────────────────────────────────────────────────────

export interface IKolReputationCache extends Document {
  handle: string;
  checked_at: Date;
  ttl_hours: number;

  metrics: IReputationMetrics;
  trust_score: number;
  recommendation: EReputationRecommendation;

  created_at: Date;
  updated_at: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const kolReputationCacheSchema = new Schema<IKolReputationCache>(
  {
    handle: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      set: (v: string) => v.replace(/^@/, ""),
    },
    checked_at: { type: Date, default: Date.now },
    ttl_hours: { type: Number, default: 24 },

    metrics: {
      type: reputationMetricsSchema,
      default: () => ({}),
    },
    trust_score: { type: Number, default: 50, min: 0, max: 100 },
    recommendation: {
      type: String,
      enum: Object.values(EReputationRecommendation),
      default: EReputationRecommendation.CAUTION,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

// ── Indexes ───────────────────────────────────────────────────────────────────

kolReputationCacheSchema.index({ checked_at: -1 });
kolReputationCacheSchema.index({ trust_score: -1 });

// ── Model ─────────────────────────────────────────────────────────────────────

export const KolReputationCache = model<IKolReputationCache>(
  "KolReputationCache",
  kolReputationCacheSchema,
);
