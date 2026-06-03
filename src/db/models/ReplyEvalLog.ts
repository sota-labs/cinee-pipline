/** ReplyEvalLog — append-only log of every reply prompt+output pair for KPI measurement */
import { Schema, model, Document } from "mongoose";

export enum EEvalLogSource {
  KOL_REPLY = "kol_reply",
  SELF_REPLY = "self_reply",
  CEO_REPLY = "ceo_reply",
}

export interface IReplyEvalLog extends Omit<Document, "model"> {
  source: EEvalLogSource;
  suggestion_id?: string;
  self_reply_queue_id?: string;
  parent_post_id?: string;
  reply_id?: string;

  prompt_hash: string;
  llmModel: string;
  prompt_length_chars: number;
  prompt_length_tokens_est: number;

  tone_used: string;
  output_text: string;
  output_length_chars: number;

  admin_decision?: "approved" | "edited" | "rejected" | "auto_afk" | "auto_manual";
  admin_edited_text?: string;
  edit_ratio?: number;

  blacklisted_words_found: string[];

  decided_at?: Date;
  created_at: Date;
  updated_at: Date;
}

const replyEvalLogSchema = new Schema<IReplyEvalLog>(
  {
    source: {
      type: String,
      enum: Object.values(EEvalLogSource),
      required: true,
    },
    suggestion_id: { type: String, index: true, sparse: true },
    self_reply_queue_id: { type: String, index: true, sparse: true },
    parent_post_id: { type: String, index: true, sparse: true },
    reply_id: { type: String, index: true, sparse: true },

    prompt_hash: { type: String, required: true, index: true },
    llmModel: { type: String, required: true, index: true },
    prompt_length_chars: { type: Number, required: true },
    prompt_length_tokens_est: { type: Number, required: true },

    tone_used: { type: String, required: true },
    output_text: { type: String, required: true },
    output_length_chars: { type: Number, required: true },

    admin_decision: {
      type: String,
      enum: ["approved", "edited", "rejected", "auto_afk", "auto_manual"],
    },
    admin_edited_text: { type: String },
    edit_ratio: { type: Number, min: 0, max: 1 },

    blacklisted_words_found: { type: [String], default: [] },

    decided_at: { type: Date, index: true },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

replyEvalLogSchema.index({ created_at: -1 });
replyEvalLogSchema.index({ suggestion_id: 1, created_at: -1 });
replyEvalLogSchema.index({ llmModel: 1, created_at: -1 });

export const ReplyEvalLog = model<IReplyEvalLog>(
  "ReplyEvalLog",
  replyEvalLogSchema
);

