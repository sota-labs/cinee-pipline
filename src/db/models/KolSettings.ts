/** KolSettings — Global configuration for KOL engagement system */
import { Schema, model, Document, Model } from "mongoose";

// ── Sub-documents ─────────────────────────────────────────────────────────────

export interface IAFKSettings {
  min_confidence_threshold: number;
  auto_delay_min_minutes: number;
  auto_delay_max_minutes: number;
  hourly_reply_limit: number;
  daily_reply_limit: number;
}

const afkSettingsSchema = new Schema<IAFKSettings>(
  {
    min_confidence_threshold: { type: Number, default: 70, min: 0, max: 100 },
    auto_delay_min_minutes: { type: Number, default: 5, min: 1 },
    auto_delay_max_minutes: { type: Number, default: 15, min: 1 },
    hourly_reply_limit: { type: Number, default: 10, min: 1 },
    daily_reply_limit: { type: Number, default: 50, min: 1 },
  },
  { _id: false },
);

export interface IManualSettings {
  notification_channel: string;
  max_pending_hours: number;
  auto_reject_after_minutes: number;
}

const manualSettingsSchema = new Schema<IManualSettings>(
  {
    notification_channel: { type: String, default: "" },
    max_pending_hours: { type: Number, default: 24, min: 1 },
    auto_reject_after_minutes: { type: Number, default: 60, min: 5 },
  },
  { _id: false },
);

export interface IPriorityWeights {
  likes_multiplier: number;
  trust_score_multiplier: number;
  question_bonus: number;
  mention_bonus: number;
}

const priorityWeightsSchema = new Schema<IPriorityWeights>(
  {
    likes_multiplier: { type: Number, default: 2.0 },
    trust_score_multiplier: { type: Number, default: 1.5 },
    question_bonus: { type: Number, default: 5 },
    mention_bonus: { type: Number, default: 3 },
  },
  { _id: false },
);

export interface ISelfReplySettings {
  enabled: boolean;
  min_comments_to_trigger: number;
  reply_interval_seconds: number;
  hourly_limit: number;
  priority_weights: IPriorityWeights;
}

const selfReplySettingsSchema = new Schema<ISelfReplySettings>(
  {
    enabled: { type: Boolean, default: true },
    min_comments_to_trigger: { type: Number, default: 5, min: 1 },
    reply_interval_seconds: { type: Number, default: 120, min: 60 },
    hourly_limit: { type: Number, default: 20, min: 1 },
    priority_weights: { type: priorityWeightsSchema, default: () => ({}) },
  },
  { _id: false },
);

export interface ISafetySettings {
  min_kol_trust_score: number;
  enable_duplicate_detection: boolean;
  enable_banned_words_filter: boolean;
  max_hourly_replies_global: number;
}

const safetySettingsSchema = new Schema<ISafetySettings>(
  {
    min_kol_trust_score: { type: Number, default: 30, min: 0, max: 100 },
    enable_duplicate_detection: { type: Boolean, default: true },
    enable_banned_words_filter: { type: Boolean, default: true },
    max_hourly_replies_global: { type: Number, default: 30, min: 1 },
  },
  { _id: false },
);

// ── Main Interface ────────────────────────────────────────────────────────────

export interface IKolSettings extends Document {
  default_mode: "afk" | "manual";

  crawl_interval_minutes: number;
  max_posts_per_crawl: number;
  max_comments_per_post: number;

  afk: IAFKSettings;
  manual: IManualSettings;
  self_reply: ISelfReplySettings;
  safety: ISafetySettings;

  updated_at: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

interface IKolSettingsModel extends Document {
  default_mode: "afk" | "manual";
  crawl_interval_minutes: number;
  max_posts_per_crawl: number;
  max_comments_per_post: number;
  afk: IAFKSettings;
  manual: IManualSettings;
  self_reply: ISelfReplySettings;
  safety: ISafetySettings;
  updated_at: Date;
}

interface KolSettingsModel extends Model<IKolSettingsModel> {
  getSettings(): Promise<IKolSettingsModel>;
}

const kolSettingsSchema = new Schema<IKolSettingsModel, KolSettingsModel>(
  {
    default_mode: {
      type: String,
      enum: ["afk", "manual"],
      default: "manual",
    },

    crawl_interval_minutes: { type: Number, default: 30, min: 5 },
    max_posts_per_crawl: { type: Number, default: 10, min: 1 },
    max_comments_per_post: { type: Number, default: 10, min: 1 },

    afk: { type: afkSettingsSchema, default: () => ({}) },
    manual: { type: manualSettingsSchema, default: () => ({}) },
    self_reply: { type: selfReplySettingsSchema, default: () => ({}) },
    safety: { type: safetySettingsSchema, default: () => ({}) },
  },
  {
    timestamps: { createdAt: false, updatedAt: "updated_at" },
  },
);

// ── Singleton pattern: only one settings document ─────────────────────────────

kolSettingsSchema.statics.getSettings = async function (): Promise<IKolSettingsModel> {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

// ── Model ─────────────────────────────────────────────────────────────────────

export const KolSettings = model<IKolSettingsModel, KolSettingsModel>("KolSettings", kolSettingsSchema);
