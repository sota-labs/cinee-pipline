/** SelfReplyQueue — Manage replies to comments on our own posts */
import { Schema, model, Document, Types } from "mongoose";

// ── Enums ──────────────────────────────────────────────────────────────────────

export enum EQueueStatus {
  ACTIVE = "active",
  PAUSED = "paused",
  COMPLETED = "completed",
}

export enum ECommentStatus {
  PENDING = "pending",
  QUEUED = "queued",
  SENT = "sent",
  SKIPPED = "skipped",
  FAILED = "failed",
}

// ── Sub-documents ─────────────────────────────────────────────────────────────

export interface IReputationCheck {
  trust_score: number;
  checked_at: Date;
  recommendation: string;
}

const reputationCheckSchema = new Schema<IReputationCheck>(
  {
    trust_score: { type: Number, default: 0 },
    checked_at: { type: Date },
    recommendation: { type: String, default: "" },
  },
  { _id: false },
);

export interface IPendingComment {
  comment_id: string;
  author_handle: string;
  content: string;
  likes: number;
  engagement_points: number;
  author_reputation?: IReputationCheck;
  author_trust_score: number;
  status: ECommentStatus;
  priority_score: number;
  scheduled_reply_at?: Date;
  replied_at?: Date;
  reply_content?: string;
  reply_id?: string;
}

const pendingCommentSchema = new Schema<IPendingComment>(
  {
    comment_id: { type: String, required: true },
    author_handle: { type: String, required: true },
    content: { type: String, required: true },
    likes: { type: Number, default: 0 },
    engagement_points: { type: Number, default: 0 },
    author_reputation: { type: reputationCheckSchema },
    author_trust_score: { type: Number, default: 50 },
    status: {
      type: String,
      enum: Object.values(ECommentStatus),
      default: ECommentStatus.PENDING,
    },
    priority_score: { type: Number, default: 0 },
    scheduled_reply_at: { type: Date },
    replied_at: { type: Date },
    reply_content: { type: String },
    reply_id: { type: String },
  },
  { _id: false },
);

// ── Main Interface ────────────────────────────────────────────────────────────

export interface ISelfReplyQueue extends Document {
  our_post_id: Types.ObjectId;
  platform: string;
  post_url: string;

  pending_comments: IPendingComment[];
  total_comments: number;
  processed_count: number;
  queue_status: EQueueStatus;

  reply_interval_seconds: number;
  last_reply_sent_at?: Date;

  created_at: Date;
  updated_at: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const selfReplyQueueSchema = new Schema<ISelfReplyQueue>(
  {
    our_post_id: {
      type: Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      index: true,
    },
    platform: { type: String, default: "twitter" },
    post_url: { type: String, required: true },

    pending_comments: { type: [pendingCommentSchema], default: [] },
    total_comments: { type: Number, default: 0 },
    processed_count: { type: Number, default: 0 },
    queue_status: {
      type: String,
      enum: Object.values(EQueueStatus),
      default: EQueueStatus.ACTIVE,
    },

    reply_interval_seconds: { type: Number, default: 120 },
    last_reply_sent_at: { type: Date },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

// ── Indexes ───────────────────────────────────────────────────────────────────

selfReplyQueueSchema.index({ our_post_id: 1 });
selfReplyQueueSchema.index({ queue_status: 1, created_at: -1 });
selfReplyQueueSchema.index({ "pending_comments.status": 1 });
selfReplyQueueSchema.index({ last_reply_sent_at: 1 });

// ── Model ─────────────────────────────────────────────────────────────────────

export const SelfReplyQueue = model<ISelfReplyQueue>(
  "SelfReplyQueue",
  selfReplyQueueSchema,
);
