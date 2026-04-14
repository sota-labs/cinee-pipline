/** Post — a piece of content authored by the CEO (includes draft/review lifecycle). */
import { Schema, model, Document } from "mongoose";

export enum EPostStatus {
  DRAFT = "draft",
  PENDING_REVIEW = "pending_review",
  EDITING = "editing",
  APPROVED = "approved",
  SCHEDULED = "scheduled",
  POSTED = "posted",
  FAILED = "failed",
  REJECTED = "rejected",
}

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

export interface IEditEntry {
  content: string;
  edited_at: Date;
  edited_by: "user" | "ai";
  prompt?: string;
}

export interface IPost extends Document {
  platform: "twitter" | "reddit" | "discord";
  content_type:
    | "hot_take"
    | "curation"
    | "announcement"
    | "engagement"
    | "thread";
  raw_content: string;
  media: IMedia[];
  video_details?: IVideoDetails;
  ai_stack: string[];
  is_viral_candidate: boolean;
  external_refs: string[];
  status: EPostStatus;
  scheduled_at?: Date;
  strategy_context?: string;
  research_source?: string;
  research_summary?: string;
  curation_source_id?: string;
  edit_history: IEditEntry[];
  post_url?: string;
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
  { _id: false },
);

const videoDetailsSchema = new Schema<IVideoDetails>(
  {
    resolution: String,
    aspect_ratio: String,
    file_size: Number,
  },
  { _id: false },
);

const editEntrySchema = new Schema<IEditEntry>(
  {
    content: { type: String, required: true },
    edited_at: { type: Date, default: Date.now },
    edited_by: { type: String, enum: ["user", "ai"], required: true },
    prompt: String,
  },
  { _id: false },
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
      enum: Object.values(EPostStatus),
      default: EPostStatus.DRAFT,
    },
    scheduled_at: Date,
    strategy_context: String,
    research_source: { type: String, default: "" },
    research_summary: { type: String, default: "" },
    curation_source_id: { type: String, default: null },
    edit_history: { type: [editEntrySchema], default: [] },
    post_url: { type: String, default: "" },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

postSchema.index({ created_at: -1 });
postSchema.index({ status: 1, scheduled_at: 1 });
postSchema.index({ content_type: 1, created_at: -1 });
postSchema.index({ raw_content: "text" });

export const Post = model<IPost>("Post", postSchema);
