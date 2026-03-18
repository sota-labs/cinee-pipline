/** Reply — the CEO's response to an Interaction. */
import { Schema, model, Document, Types } from "mongoose";

export interface IReply extends Document {
  interaction_id: Types.ObjectId;
  reply_content: string;
  tone_used: "supportive" | "visionary" | "challenging" | "curious" | "grateful";
  thread_id?: string;
  platform_id?: string;
  created_at: Date;
  updated_at: Date;
}

const replySchema = new Schema<IReply>(
  {
    interaction_id: {
      type: Schema.Types.ObjectId,
      ref: "Interaction",
      required: true,
      index: true,
    },
    reply_content: { type: String, required: true },
    tone_used: {
      type: String,
      enum: ["supportive", "visionary", "challenging", "curious", "grateful"],
      required: true,
      default: "supportive",
    },
    thread_id: String,
    platform_id: { type: String, sparse: true },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

export const Reply = model<IReply>("Reply", replySchema);
