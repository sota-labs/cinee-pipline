/** Reply — the CEO's response to a mention or comment. */
import { Schema, model, Document } from "mongoose";

export enum EReplyStatus {
  DRAFT    = "draft",
  REJECTED = "rejected",
  RESOLVED = "resolved",
  REPLIED  = "replied",
}

export enum EReplyTone {
  SUPPORTIVE  = "supportive",
  VISIONARY   = "visionary",
  CHALLENGING = "challenging",
  CURIOUS     = "curious",
  GRATEFUL    = "grateful",
}

export enum EReplyPlatform {
  X      = "x",
  REDDIT = "reddit",
}

export interface IReply extends Document {
  reply_content: string;
  tone_used: EReplyTone;
  thread_id?: string;
  status: EReplyStatus;
  platform: EReplyPlatform;
  url?: string;
  created_at: Date;
  updated_at: Date;
}

const replySchema = new Schema<IReply>(
  {
    reply_content: { type: String, required: true },
    tone_used: {
      type: String,
      enum: Object.values(EReplyTone),
      required: true,
      default: EReplyTone.SUPPORTIVE,
    },
    thread_id: { type: String, unique: true, sparse: true },
    status: {
      type: String,
      enum: Object.values(EReplyStatus),
      required: true,
      default: EReplyStatus.RESOLVED,
    },
    platform: {
      type: String,
      enum: Object.values(EReplyPlatform),
      required: true,
      default: EReplyPlatform.X,
    },
    url: String,
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

replySchema.index({ status: 1, created_at: -1 });
replySchema.index({ platform: 1 });

export const Reply = model<IReply>("Reply", replySchema);
