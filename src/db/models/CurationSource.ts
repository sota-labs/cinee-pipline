/** CurationSource — X posts collected during research phase. Used to inform draft creation. */
import { Schema, model, Document } from "mongoose";

export enum ECurationStatus {
  NEW = "new",
  SELECTED = "selected",
  USED = "used",
}

export enum ECurationMediaType {
  VIDEO = "video",
  IMAGE = "image",
  GIF = "gif",
  NONE = "none",
}

export interface ICurationSource extends Document {
  source_url: string;
  author_handle: string;
  author_follower_count?: number;
  content: string;
  media_type: ECurationMediaType;
  media_url?: string;
  thumbnail_url?: string;
  duration?: number;
  likes: number;
  comments: number;
  retweets: number;
  views: number;
  hashtags: string[];
  keyword_searched: string;
  engagement_score: number;
  posted_at?: Date;
  scraped_at: Date;
  status: ECurationStatus;
  created_at: Date;
  updated_at: Date;
}

const curationSourceSchema = new Schema<ICurationSource>(
  {
    source_url: { type: String, required: true, unique: true },
    author_handle: { type: String, required: true, default: "" },
    author_follower_count: { type: Number },
    content: { type: String, required: true, default: "" },
    media_type: {
      type: String,
      enum: Object.values(ECurationMediaType),
      default: ECurationMediaType.NONE,
    },
    media_url: { type: String },
    thumbnail_url: { type: String },
    duration: { type: Number },
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    retweets: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
    hashtags: { type: [String], default: [] },
    keyword_searched: { type: String, default: "" },
    engagement_score: { type: Number, default: 0 },
    posted_at: { type: Date },
    scraped_at: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: Object.values(ECurationStatus),
      default: ECurationStatus.NEW,
    },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

curationSourceSchema.index({ engagement_score: -1 });
curationSourceSchema.index({ status: 1, scraped_at: -1 });
curationSourceSchema.index({ keyword_searched: 1, scraped_at: -1 });

export const CurationSource = model<ICurationSource>(
  "CurationSource",
  curationSourceSchema,
);
