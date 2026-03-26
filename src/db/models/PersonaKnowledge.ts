import { Schema, model, Document } from "mongoose";

export interface IPersonaKnowledge extends Document {
  topic: string;
  stance: string;
  notes?: string;
  confidence?: number;
  created_at: Date;
  updated_at: Date;
}

const personaSchema = new Schema<IPersonaKnowledge>(
  {
    topic: { type: String, required: true, unique: true },
    stance: { type: String, required: true },
    notes: String,
    confidence: Number,
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  }
);

export const PersonaKnowledge = model<IPersonaKnowledge>("PersonaKnowledge", personaSchema);
