/** CurationSource — an AI film found by OpenClaw that can be amplified. */
import { Schema, model, Document } from "mongoose";

export interface ICurationSource extends Document {
  source_url: string;
  platform: "twitter" | "reddit" | "youtube" | "vimeo" | "other";
  creator_name: string;
  creator_handle?: string;
  key_takeaway: string;
  ai_stack: string[];
  used: boolean;
  video_details?: {
    resolution?: string;
    aspect_ratio?: string;
    duration?: number;
  };
  engagement_score?: number;
  created_at: Date;
  updated_at: Date;
}

const curationSourceSchema = new Schema<ICurationSource>(
  {
    source_url: { type: String, required: true, unique: true },
    platform: {
      type: String,
      enum: ["twitter", "reddit", "youtube", "vimeo", "other"],
      default: "twitter",
    },
    creator_name: { type: String, required: true },
    creator_handle: String,
    key_takeaway: { type: String, required: true },
    ai_stack: { type: [String], default: [] },
    used: { type: Boolean, default: false, index: true },
    video_details: {
      type: new Schema(
        { resolution: String, aspect_ratio: String, duration: Number },
        { _id: false }
      ),
    },
    engagement_score: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

curationSourceSchema.index({ used: 1, created_at: -1 });
curationSourceSchema.index({ creator_handle: 1 });

export const CurationSource = model<ICurationSource>("CurationSource", curationSourceSchema);
