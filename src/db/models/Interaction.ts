/** Interaction — incoming tweet/comment from other users that the CEO should react to. */
import { Schema, model, Document } from "mongoose";

export interface IInteraction extends Document {
  platform_id: string;
  platform: "twitter" | "reddit" | "discord";
  author_handle: string;
  content: string;
  category: "question" | "praise" | "critique" | "neutral";
  processed: boolean;
  context_summary?: string;
  created_at: Date;
  updated_at: Date;
}

const interactionSchema = new Schema<IInteraction>(
  {
    platform_id: { type: String, required: true, unique: true },
    platform: {
      type: String,
      enum: ["twitter", "reddit", "discord"],
      required: true,
      default: "twitter",
    },
    author_handle: { type: String, required: true },
    content: { type: String, required: true },
    category: {
      type: String,
      enum: ["question", "praise", "critique", "neutral"],
      default: "neutral",
    },
    processed: { type: Boolean, default: false, index: true },
    context_summary: String,
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

interactionSchema.index({ processed: 1, created_at: -1 });
interactionSchema.index({ author_handle: 1 });

export const Interaction = model<IInteraction>("Interaction", interactionSchema);
