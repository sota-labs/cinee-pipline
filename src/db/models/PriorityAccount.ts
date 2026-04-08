import { Schema, model, Document } from "mongoose";

// ── Enums ─────────────────────────────────────────────────────────────────────

export enum ERelationshipTier {
  /** Manually pinned VIP / partner — always top priority */
  STRATEGIC = "STRATEGIC",
  /** CS > 80 — highly active inner circle */
  CLOSE_FRIEND = "CLOSE_FRIEND",
  /** CS 50–80 — engaged ally */
  ALLIED = "ALLIED",
  /** CS < 50 — cold / new contact */
  STRANGER = "STRANGER",
}

// ── Interface ─────────────────────────────────────────────────────────────────

export interface IPriorityAccount extends Document {
  /** @username on X (without the @, stored lowercase) */
  handle: string;

  /** If true: manually chosen VIP; adds +100 Manual Bonus to HCS */
  is_manual_priority: boolean;

  /**
   * Cached Closeness Score (CS).
   * Recomputed whenever interactions change or recalculate is called.
   * CS = (F × w1) + (Q × w2) + (I × w3) − (D × w4)
   */
  closeness_score: number;

  /**
   * Cached Hybrid Closeness Score (HCS).
   * HCS = (CS × decayFactor) + manualBonus
   */
  hybrid_score: number;

  /** Derived from is_manual_priority + CS; auto-computed on save */
  relationship_tier: ERelationshipTier;

  /** Free-text vibe notes (manually written or AI-summarised every 10 posts) */
  vibe_notes: string;

  /** Last time this account interacted with the CEO's content */
  last_seen_at: Date;

  /** Follower count — used for Impact (I) calculation */
  follower_count: number;

  // ── Rolling 30-day interaction counters ─────────────────────────────────────
  likes_30d: number;
  comments_30d: number;
  shares_30d: number;

  // ── Mongoose timestamps ──────────────────────────────────────────────────────
  created_at: Date;
  updated_at: Date;
}

// ── Schema ────────────────────────────────────────────────────────────────────

const priorityAccountSchema = new Schema<IPriorityAccount>(
  {
    handle: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      set: (v: string) => v.replace(/^@/, ""), // strip leading @ if supplied
    },
    is_manual_priority: { type: Boolean, default: false },
    closeness_score: { type: Number, default: 0, min: 0 },
    hybrid_score: { type: Number, default: 0, min: 0 },
    relationship_tier: {
      type: String,
      enum: Object.values(ERelationshipTier),
      default: ERelationshipTier.STRANGER,
    },
    vibe_notes: { type: String, default: "" },
    last_seen_at: { type: Date, default: null },
    follower_count: { type: Number, default: 0, min: 0 },
    likes_30d: { type: Number, default: 0, min: 0 },
    comments_30d: { type: Number, default: 0, min: 0 },
    shares_30d: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
  },
);

// ── Indexes ───────────────────────────────────────────────────────────────────

priorityAccountSchema.index({ hybrid_score: -1 });
priorityAccountSchema.index({ relationship_tier: 1 });
priorityAccountSchema.index({ is_manual_priority: 1 });

// ── Model ─────────────────────────────────────────────────────────────────────

export const PriorityAccount = model<IPriorityAccount>(
  "PriorityAccount",
  priorityAccountSchema,
);
