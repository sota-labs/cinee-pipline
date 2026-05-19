/** KolPost — Posts crawled from KOLs for engagement analysis */
import { Schema, model, Document, Types } from "mongoose";

// ── Enums ──────────────────────────────────────────────────────────────────────

export enum EKolPostStatus {
  NEW = "new",
  ANALYZED = "analyzed",
  PENDING_REPLY = "pending_reply",
  REPLIED = "replied",
  SKIPPED = "skipped",
}

export enum ESentiment {
  POSITIVE = "positive",
  NEGATIVE = "negative",
  NEUTRAL = "neutral",
}

// ── Sub-documents ─────────────────────────────────────────────────────────────

export interface ITopComment {
  content: string;
  author_handle: string;
  likes: number;
  sentiment: string;
  reply_count: number;
}

const topCommentSchema = new Schema<ITopComment>(
  {
    content: { type: String, required: true },
    author_handle: { type: String, required: true },
    likes: { type: Number, default: 0 },
    sentiment: { type: String, default: "" },
    reply_count: { type: Number, default: 0 },
  },
  { _id: false },
);

export interface IEngagementPattern {
  dominant_tone: string;
  common_phrases: string[];
  emoji_trend: string[];
  question_ratio: number;
}

const engagementPatternSchema = new Schema<IEngagementPattern>(
  {
    dominant_tone: { type: String, default: "" },
    common_phrases: { type: [String], default: [] },
    emoji_trend: { type: [String], default: [] },
    question_ratio: { type: Number, default: 0 },
  },
  { _id: false },
);

export interface IAnalysisResult {
  summary: string;
  sentiment: ESentiment;
  trending_topics: string[];
  virality_score: number;
}

const analysisResultSchema = new Schema<IAnalysisResult>(
  {
    summary: { type: String, default: "" },
    sentiment: {
      type: String,
      enum: Object.values(ESentiment),
      default: ESentiment.NEUTRAL,
    },
    trending_topics: { type: [String], default: [] },
    virality_score: { type: Number, default: 0, min: 0, max: 100 },
  },
  { _id: false },
);

// ── Main Interface ────────────────────────────────────────────────────────────

export interface IKolPost extends Document {
  kol_id: Types.ObjectId;
  platform: "twitter" | "reddit";
  post_url: string;
  content: string;
  media_urls: string[];
  posted_at: Date;

  likes: number;
  comments: number;
  retweets: number;
  views: number;
  engagement_score: number;

  status: EKolPostStatus;
  is_retweet: boolean;
  is_quote: boolean;
  quoted_post_url?: string;
  analysis: IAnalysisResult;
  top_comments: ITopComment[];
  engagement_pattern: IEngagementPattern;

  crawled_at: Date;
  analyzed_at?: Date;
  replied_at?: Date;
  replied_comment_id?: string;

  created_at: Date;
  updated_at: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const kolPostSchema = new Schema<IKolPost>(
  {
    kol_id: {
      type: Schema.Types.ObjectId,
      ref: "KolProfile",
      required: true,
      index: true,
    },
    platform: {
      type: String,
      enum: ["twitter", "reddit"],
      default: "twitter",
    },
    post_url: { type: String, required: true, unique: true },
    content: { type: String, required: true, default: "" },
    media_urls: { type: [String], default: [] },
    posted_at: { type: Date, required: true },

    likes: { type: Number, default: 0, min: 0 },
    comments: { type: Number, default: 0, min: 0 },
    retweets: { type: Number, default: 0, min: 0 },
    views: { type: Number, default: 0, min: 0 },
    engagement_score: { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: Object.values(EKolPostStatus),
      default: EKolPostStatus.NEW,
    },
    is_retweet: { type: Boolean, default: false },
    is_quote: { type: Boolean, default: false },
    quoted_post_url: { type: String },
    analysis: {
      type: analysisResultSchema,
      default: () => ({}),
    },
    top_comments: { type: [topCommentSchema], default: [] },
    engagement_pattern: {
      type: engagementPatternSchema,
      default: () => ({}),
    },

    crawled_at: { type: Date, default: Date.now },
    analyzed_at: { type: Date },
    replied_at: { type: Date },
    replied_comment_id: { type: String },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

// ── Indexes ───────────────────────────────────────────────────────────────────

kolPostSchema.index({ kol_id: 1, posted_at: -1 });
kolPostSchema.index({ status: 1, crawled_at: -1 });
kolPostSchema.index({ engagement_score: -1 });
kolPostSchema.index({ platform: 1, posted_at: -1 });

// ── Model ─────────────────────────────────────────────────────────────────────

export const KolPost = model<IKolPost>("KolPost", kolPostSchema);
