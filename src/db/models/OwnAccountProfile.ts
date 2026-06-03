/** OwnAccountProfile — singleton personality model for the CEO's own account */
import { Schema, model, Document } from "mongoose";

// ── Manual Config Sub-document ────────────────────────────────────────────────

export interface IOwnAccountManualConfig {
  writing_style: string;
  slang_words: string[];
  emoji_pattern: string;
  sentence_structure: string;
  engagement_tone: string;
  avg_post_length: number;
}

const manualConfigSchema = new Schema<IOwnAccountManualConfig>(
  {
    writing_style: { type: String, default: "" },
    slang_words: { type: [String], default: [] },
    emoji_pattern: { type: String, default: "" },
    sentence_structure: { type: String, default: "" },
    engagement_tone: { type: String, default: "" },
    avg_post_length: { type: Number, default: 0 },
  },
  { _id: false },
);

// ── Learned Profile Sub-document ──────────────────────────────────────────────

export interface IOwnAccountLearnedProfile {
  writing_style: string;
  slang_words: string[];
  emoji_pattern: string;
  sentence_structure: string;
  engagement_tone: string;
  avg_post_length: number;
  last_learned_at: Date | null;
  last_learn_trigger_at: Date | null;
  posts_analyzed: number;
  learning_confidence: number;
}

const learnedProfileSchema = new Schema<IOwnAccountLearnedProfile>(
  {
    writing_style: { type: String, default: "" },
    slang_words: { type: [String], default: [] },
    emoji_pattern: { type: String, default: "" },
    sentence_structure: { type: String, default: "" },
    engagement_tone: { type: String, default: "" },
    avg_post_length: { type: Number, default: 0 },
    last_learned_at: { type: Date, default: null },
    last_learn_trigger_at: { type: Date, default: null },
    posts_analyzed: { type: Number, default: 0 },
    learning_confidence: { type: Number, default: 0, min: 0, max: 100 },
  },
  { _id: false },
);

// ── Effective Profile Sub-document ────────────────────────────────────────────

export interface IOwnAccountEffectiveProfile {
  writing_style: string;
  slang_words: string[];
  emoji_pattern: string;
  sentence_structure: string;
  engagement_tone: string;
  avg_post_length: number;
}

const effectiveProfileSchema = new Schema<IOwnAccountEffectiveProfile>(
  {
    writing_style: { type: String, default: "" },
    slang_words: { type: [String], default: [] },
    emoji_pattern: { type: String, default: "" },
    sentence_structure: { type: String, default: "" },
    engagement_tone: { type: String, default: "" },
    avg_post_length: { type: Number, default: 0 },
  },
  { _id: false },
);

// ── Main Interface ────────────────────────────────────────────────────────────

export interface IOwnAccountProfile extends Document {
  _key: string;
  manual_config: IOwnAccountManualConfig;
  learned_profile: IOwnAccountLearnedProfile;
  effective_profile: IOwnAccountEffectiveProfile;
  created_at: Date;
  updated_at: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const ownAccountProfileSchema = new Schema<IOwnAccountProfile>(
  {
    _key: {
      type: String,
      required: true,
      unique: true,
      default: "own_account",
    },
    manual_config: { type: manualConfigSchema, default: () => ({}) },
    learned_profile: { type: learnedProfileSchema, default: () => ({}) },
    effective_profile: { type: effectiveProfileSchema, default: () => ({}) },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

// ── Indexes ───────────────────────────────────────────────────────────────────


// ── Model ─────────────────────────────────────────────────────────────────────

export const OwnAccountProfile = model<IOwnAccountProfile>(
  "OwnAccountProfile",
  ownAccountProfileSchema,
);
