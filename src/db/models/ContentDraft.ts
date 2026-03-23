/** ContentDraft — content pending user review via Telegram. */
import { Schema, model, Document } from "mongoose";

export enum EDraftStatus {
  PENDING_REVIEW = "pending_review",
  EDITING = "editing",
  APPROVED = "approved",
  SCHEDULED = "scheduled",
  PROCESSING = "processing",
  POSTED = "posted",
  REJECTED = "rejected",
  FAILED = "failed",
}

export interface IEditEntry {
  content: string;
  edited_at: Date;
  edited_by: "user" | "ai";
  prompt?: string;
}

export interface IContentDraft extends Document {
  raw_content: string;
  research_source: string;
  research_summary: string;
  ai_stack: string[];
  status: EDraftStatus;
  platform: "twitter";
  content_type: "hot_take" | "curation" | "announcement" | "engagement" | "thread";
  telegram_message_id?: number;
  telegram_chat_id?: string;
  scheduled_at?: Date;
  edit_history: IEditEntry[];
  post_id?: string;
  created_at: Date;
  updated_at: Date;
}

const editEntrySchema = new Schema<IEditEntry>(
  {
    content: { type: String, required: true },
    edited_at: { type: Date, default: Date.now },
    edited_by: { type: String, enum: ["user", "ai"], required: true },
    prompt: String,
  },
  { _id: false }
);

const contentDraftSchema = new Schema<IContentDraft>(
  {
    raw_content: { type: String, required: true },
    research_source: { type: String, default: "" },
    research_summary: { type: String, default: "" },
    ai_stack: { type: [String], default: [] },
    status: {
      type: String,
      enum: Object.values(EDraftStatus),
      default: EDraftStatus.PENDING_REVIEW,
    },
    platform: {
      type: String,
      enum: ["twitter"],
      default: "twitter",
    },
    content_type: {
      type: String,
      enum: ["hot_take", "curation", "announcement", "engagement", "thread"],
      default: "hot_take",
    },
    telegram_message_id: Number,
    telegram_chat_id: String,
    scheduled_at: Date,
    edit_history: { type: [editEntrySchema], default: [] },
    post_id: { type: String, index: true, sparse: true },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

contentDraftSchema.index({ status: 1, created_at: -1 });
contentDraftSchema.index({ scheduled_at: 1 }, { sparse: true });

export const ContentDraft = model<IContentDraft>("ContentDraft", contentDraftSchema);
