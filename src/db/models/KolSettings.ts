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

export interface ITierCrawlIntervals {
  S: number;
  A: number;
  B: number;
  C: number;
}

const tierCrawlIntervalsSchema = new Schema<ITierCrawlIntervals>(
  {
    S: { type: Number, default: 15, min: 5  },
    A: { type: Number, default: 240, min: 30 },
    B: { type: Number, default: 240, min: 60 },
    C: { type: Number, default: 480, min: 60 },
  },
  { _id: false },
);

export interface IPrimeWindow {
  start_hour: number;  // 0-23, server-local (UTC)
  end_hour: number;    // 1-24, strictly > start_hour (or wrap-around midnight)
}

const primeWindowSchema = new Schema<IPrimeWindow>(
  {
    start_hour: { type: Number, default: 9, min: 0, max: 23 },
    end_hour:   { type: Number, default: 13, min: 1, max: 24 },
  },
  { _id: false },
);

export interface ITierBatchIntervals {
  A: number;  // minutes, >= 5
  B: number;  // >= 30
  C: number;  // >= 30
}

const tierBatchIntervalsSchema = new Schema<ITierBatchIntervals>(
  {
    A: { type: Number, default: 120, min: 5  },
    B: { type: Number, default: 180, min: 30 },
    C: { type: Number, default: 240, min: 60 },
  },
  { _id: false },
);

export function isWithinPrimeWindow(pw: IPrimeWindow, now: Date = new Date()): boolean {
  const h = now.getUTCHours();
  const { start_hour: s, end_hour: e } = pw;
  if (s === e) return false; // empty window
  if (s < e) return h >= s && h < e;
  // wrap-around midnight (e.g. 22..2)
  return h >= s || h < e;
}

// ── Main Interface ────────────────────────────────────────────────────────────

export interface IKolSettings extends Document {
  default_mode: "afk" | "manual";

  crawl_interval_minutes: number;
  max_posts_per_crawl: number;
  max_comments_per_post: number;
  crawl_handles_per_task: number;
  crawl_concurrency: number;
  analyze_batch_size: number;
  afk_skip_cashtag_whitelist: string[];

  afk: IAFKSettings;
  manual: IManualSettings;
  self_reply: ISelfReplySettings;
  safety: ISafetySettings;
  tier_crawl_intervals: ITierCrawlIntervals;
  prime_window: IPrimeWindow;
  tier_batch_intervals: ITierBatchIntervals;

  updated_at: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

interface KolSettingsModel extends Model<IKolSettings> {
  getSettings(): Promise<IKolSettings>;
}

const kolSettingsSchema = new Schema<IKolSettings, KolSettingsModel>(
  {
    default_mode: {
      type: String,
      enum: ["afk", "manual"],
      default: "manual",
    },

    crawl_interval_minutes: { type: Number, default: 240, min: 5 },
    max_posts_per_crawl: { type: Number, default: 10, min: 1 },
    max_comments_per_post: { type: Number, default: 10, min: 1 },
    crawl_handles_per_task: { type: Number, default: 2, min: 1 },
    crawl_concurrency: { type: Number, default: 5, min: 1, max: 20 },
    analyze_batch_size: { type: Number, default: 10, min: 1 },
    afk_skip_cashtag_whitelist: {
      type: [String],
      default: ["WIF","BONK","PEPE","DOGE","SOL","BTC","ETH","BNB","BASE","SUI"],
    },

    afk: { type: afkSettingsSchema, default: () => ({}) },
    manual: { type: manualSettingsSchema, default: () => ({}) },
    self_reply: { type: selfReplySettingsSchema, default: () => ({}) },
    safety: { type: safetySettingsSchema, default: () => ({}) },
    tier_crawl_intervals: { type: tierCrawlIntervalsSchema, default: () => ({}) },
    prime_window: { type: primeWindowSchema, default: () => ({}) },
    tier_batch_intervals: { type: tierBatchIntervalsSchema, default: () => ({}) },
  },
  {
    timestamps: { createdAt: false, updatedAt: "updated_at" },
  },
);

// ── Singleton pattern: only one settings document ─────────────────────────────

kolSettingsSchema.statics.getSettings = async function (): Promise<IKolSettings> {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

// ── Model ─────────────────────────────────────────────────────────────────────

export const KolSettings = model<IKolSettings, KolSettingsModel>("KolSettings", kolSettingsSchema);
