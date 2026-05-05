/** KolReplySuggestion — AI-generated reply suggestions with execution tracking */
import { Schema, model, Document, Types } from "mongoose";

// ── Enums ──────────────────────────────────────────────────────────────────────

export enum EReplyMode {
  AFK = "afk",
  MANUAL = "manual",
}

export enum EReplyExecutionStatus {
  PENDING = "pending",
  SENT = "sent",
  FAILED = "failed",
  BANNED = "banned",
}

export enum EAdminDecision {
  APPROVED = "approved",
  REJECTED = "rejected",
  EDITED = "edited",
}

// ── Sub-documents ─────────────────────────────────────────────────────────────

export interface ISuggestion {
  id: string;
  content: string;
  tone: string;
  confidence: number;
  reasoning: string;
  expected_engagement: number;
}

const suggestionSchema = new Schema<ISuggestion>(
  {
    id: { type: String, required: true },
    content: { type: String, required: true },
    tone: { type: String, required: true },
    confidence: { type: Number, default: 0, min: 0, max: 100 },
    reasoning: { type: String, default: "" },
    expected_engagement: { type: Number, default: 0 },
  },
  { _id: false },
);

// ── Main Interface ────────────────────────────────────────────────────────────

export interface IKolReplySuggestion extends Document {
  kol_post_id: Types.ObjectId;

  suggestions: ISuggestion[];
  mode: EReplyMode;

  selected_suggestion_id?: string;
  auto_reply_scheduled_at?: Date;

  telegram_message_id?: number;
  admin_decision?: EAdminDecision;
  admin_edited_content?: string;
  admin_decided_at?: Date;

  execution_status: EReplyExecutionStatus;
  sent_comment_id?: string;
  sent_at?: Date;
  error_message?: string;

  created_at: Date;
  updated_at: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const kolReplySuggestionSchema = new Schema<IKolReplySuggestion>(
  {
    kol_post_id: {
      type: Schema.Types.ObjectId,
      ref: "KolPost",
      required: true,
      index: true,
    },

    suggestions: { type: [suggestionSchema], default: [] },
    mode: {
      type: String,
      enum: Object.values(EReplyMode),
      required: true,
    },

    selected_suggestion_id: { type: String },
    auto_reply_scheduled_at: { type: Date },

    telegram_message_id: { type: Number },
    admin_decision: {
      type: String,
      enum: Object.values(EAdminDecision),
    },
    admin_edited_content: { type: String },
    admin_decided_at: { type: Date },

    execution_status: {
      type: String,
      enum: Object.values(EReplyExecutionStatus),
      default: EReplyExecutionStatus.PENDING,
    },
    sent_comment_id: { type: String },
    sent_at: { type: Date },
    error_message: { type: String },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

// ── Indexes ───────────────────────────────────────────────────────────────────

kolReplySuggestionSchema.index({ kol_post_id: 1 });
kolReplySuggestionSchema.index({ mode: 1, execution_status: 1 });
kolReplySuggestionSchema.index({ execution_status: 1, auto_reply_scheduled_at: 1 });
kolReplySuggestionSchema.index({ created_at: -1 });

// ── Model ─────────────────────────────────────────────────────────────────────

export const KolReplySuggestion = model<IKolReplySuggestion>(
  "KolReplySuggestion",
  kolReplySuggestionSchema,
);
