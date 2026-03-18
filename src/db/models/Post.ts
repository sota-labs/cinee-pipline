/** Post — a piece of content authored by the CEO. */
import { Schema, model, Document, Types } from "mongoose";

export interface IMedia {
  type: "video" | "image" | "gif";
  url: string;
  thumbnail?: string;
  duration?: number;
}

export interface IVideoDetails {
  resolution?: string;
  aspect_ratio?: string;
  file_size?: number;
}

export interface IMetadata {
  likes?: number;
  retweets?: number;
  replies?: number;
  quotes?: number;
  views?: number;
}

export interface IPost extends Document {
  platform: "twitter" | "reddit" | "discord";
  content_type: "hot_take" | "curation" | "announcement" | "engagement" | "thread";
  raw_content: string;
  media: IMedia[];
  video_details?: IVideoDetails;
  ai_stack: string[];
  is_viral_candidate: boolean;
  external_refs: string[];
  status: "draft" | "scheduled" | "posted" | "failed";
  platform_id?: string;
  metadata: IMetadata;
  scheduled_at?: Date;
  strategy_context?: string;
  created_at: Date;
  updated_at: Date;
}

const mediaSchema = new Schema<IMedia>(
  {
    type: { type: String, enum: ["video", "image", "gif"], required: true },
    url: { type: String, required: true },
    thumbnail: String,
    duration: Number,
  },
  { _id: false }
);

const videoDetailsSchema = new Schema<IVideoDetails>(
  {
    resolution: String,
    aspect_ratio: String,
    file_size: Number,
  },
  { _id: false }
);

const metadataSchema = new Schema<IMetadata>(
  {
    likes: { type: Number, default: 0 },
    retweets: { type: Number, default: 0 },
    replies: { type: Number, default: 0 },
    quotes: { type: Number, default: 0 },
    views: { type: Number, default: 0 },
  },
  { _id: false }
);

const postSchema = new Schema<IPost>(
  {
    platform: {
      type: String,
      enum: ["twitter", "reddit", "discord"],
      required: true,
      default: "twitter",
    },
    content_type: {
      type: String,
      enum: ["hot_take", "curation", "announcement", "engagement", "thread"],
      required: true,
      default: "engagement",
    },
    raw_content: { type: String, required: true },
    media: { type: [mediaSchema], default: [] },
    video_details: videoDetailsSchema,
    ai_stack: { type: [String], default: [] },
    is_viral_candidate: { type: Boolean, default: false },
    external_refs: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["draft", "scheduled", "posted", "failed"],
      default: "draft",
    },
    platform_id: { type: String, index: true, sparse: true },
    metadata: { type: metadataSchema, default: () => ({}) },
    scheduled_at: Date,
    strategy_context: String,
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

postSchema.index({ created_at: -1 });
postSchema.index({ status: 1, scheduled_at: 1 });
postSchema.index({ content_type: 1, created_at: -1 });
postSchema.index({ raw_content: "text" });

export const Post = model<IPost>("Post", postSchema);
