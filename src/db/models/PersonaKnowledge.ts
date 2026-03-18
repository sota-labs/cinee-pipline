/** PersonaKnowledge — the CEO's stances and opinions on key topics. */
import { Schema, model, Document } from "mongoose";

export interface IPersonaKnowledge extends Document {
  topic: string;
  stance: string;
  keywords: string[];
  created_at: Date;
  updated_at: Date;
}

const personaKnowledgeSchema = new Schema<IPersonaKnowledge>(
  {
    topic: { type: String, required: true, unique: true },
    stance: { type: String, required: true },
    keywords: { type: [String], default: [] },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

personaKnowledgeSchema.index({ keywords: 1 });

export const PersonaKnowledge = model<IPersonaKnowledge>(
  "PersonaKnowledge",
  personaKnowledgeSchema
);
