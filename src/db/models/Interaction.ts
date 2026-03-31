import { Schema, model, Document } from "mongoose";

export interface IInteraction extends Document {
  platform: "x" | "reddit";
  source_url: string;
  bot_comment_content: string;
  status: string;
  created_at: Date;
  updated_at: Date;
}

const interactionSchema = new Schema<IInteraction>(
  {
    platform: { type: String, enum: ["x", "reddit"], required: true, default: "x" },
    source_url: { type: String, required: true, unique: true },
    bot_comment_content: { type: String, required: true },
    status: { type: String, default: "replied" },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

interactionSchema.index({ source_url: 1 }, { unique: true });

export const Interaction = model<IInteraction>("Interaction", interactionSchema);
