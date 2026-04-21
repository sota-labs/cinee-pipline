/** Kol — Key Opinion Leader / Influencer model */
import { Schema, model, Document, Types } from "mongoose";

// ── Enums ─────────────────────────────────────────────────────────────────────

export type TKolStatus = "NEW" | "PROCESSING" | "PROCESSED" | "SKIPPED" | "FAILED";

export enum EKolStatus {
  NEW = "NEW",
  PROCESSING = "PROCESSING",
  PROCESSED = "PROCESSED",
  SKIPPED = "SKIPPED",
  FAILED = "FAILED",
}

export type TPendingCommentStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "POSTED" | "FAILED" | "AUTO_SELECTED";

export enum EPendingCommentStatus {
  PENDING_REVIEW = "PENDING_REVIEW",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  POSTED = "POSTED",
  FAILED = "FAILED",
  AUTO_SELECTED = "AUTO_SELECTED",
}

// ── Interfaces ─────────────────────────────────────────────────────────────────

export interface IKolPostProcessing {
  kolPostId: string;
  summary: string;
  topComments: unknown[];
  sentimentJson: Record<string, unknown>;
  trendSummary: string;
  processedAt: Date;
}

export interface IPendingComment {
  _id?: Types.ObjectId;
  kolPostId: string;
  kolId: string;
  content: string;
  alignment: string;
  rationale: string;
  candidateIndex: number;
  isAutoSelected: boolean;
  status: TPendingCommentStatus;
  telegramMessageId?: string;
  postedAt?: Date;
  postedUrl?: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IKolPost extends Document {
  kolId: string;
  platform: string;
  postUrl: string;
  externalPostId: string;
  content: string;
  likes: number;
  comments: number;
  shares: number;
  engagementScore: number;
  postedAt: Date;
  status: TKolStatus;
  processing?: IKolPostProcessing;
  pendingComments?: IPendingComment[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IKolEmbedding extends Document {
  kolId: string;
  content: string;
  embedding: number[];
  postedAt: Date;
  createdAt: Date;
}

export interface IKol extends Document {
  handle: string;
  platform: string;
  displayName: string;
  profileUrl: string;
  followersCount: number;
  isActive: boolean;
  writingSamples: string[];
  styleSummary: string;
  personalityNotes: string;
  slangVocab: string[];
  styleLastLearnedAt?: Date;
  stylePostCountAtLastLearn: number;
  lastCrawledAt?: Date;
  notes: string;
  posts: IKolPost["_id"][];
  embeddings: IKolEmbedding["_id"][];
  createdAt: Date;
  updatedAt: Date;
}

// ── Subdocument Schemas ──────────────────────────────────────────────────────

const kolPostProcessingSchema = new Schema<IKolPostProcessing>(
  {
    kolPostId: { type: String, required: true, unique: true },
    summary: { type: String, default: "" },
    topComments: { type: [Schema.Types.Mixed], default: [] },
    sentimentJson: { type: Schema.Types.Mixed, default: {} },
    trendSummary: { type: String, default: "" },
    processedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const pendingCommentSchema = new Schema<IPendingComment>(
  {
    kolPostId: { type: String, required: true },
    kolId: { type: String, required: true },
    content: { type: String, required: true },
    alignment: { type: String, required: true },
    rationale: { type: String, default: "" },
    candidateIndex: { type: Number, required: true },
    isAutoSelected: { type: Boolean, default: false },
    status: {
      type: String,
      enum: Object.values(EPendingCommentStatus),
      default: EPendingCommentStatus.PENDING_REVIEW,
    },
    telegramMessageId: { type: String, default: null },
    postedAt: { type: Date, default: null },
    postedUrl: { type: String, default: null },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
    _id: true,
  }
);

// ── Main Schemas ─────────────────────────────────────────────────────────────

const kolPostSchema = new Schema<IKolPost>(
  {
    kolId: { type: String, required: true, index: true },
    platform: { type: String, default: "x" },
    postUrl: { type: String, required: true, unique: true },
    externalPostId: { type: String, required: true },
    content: { type: String, required: true },
    likes: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    shares: { type: Number, default: 0 },
    engagementScore: { type: Number, default: 0 },
    postedAt: { type: Date, required: true },
    status: {
      type: String,
      enum: Object.values(EKolStatus),
      default: EKolStatus.NEW,
    },
    processing: { type: kolPostProcessingSchema, default: null },
    pendingComments: { type: [pendingCommentSchema], default: [] },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
  }
);

const kolEmbeddingSchema = new Schema<IKolEmbedding>(
  {
    kolId: { type: String, required: true, index: true },
    content: { type: String, required: true },
    embedding: { type: [Number], required: true },
    postedAt: { type: Date, required: true },
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: false },
  }
);

const kolSchema = new Schema<IKol>(
  {
    handle: { type: String, required: true },
    platform: { type: String, default: "x" },
    displayName: { type: String, default: "" },
    profileUrl: { type: String, default: "" },
    followersCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    writingSamples: { type: [String], default: [] },
    styleSummary: { type: String, default: "" },
    personalityNotes: { type: String, default: "" },
    slangVocab: { type: [String], default: [] },
    styleLastLearnedAt: { type: Date, default: null },
    stylePostCountAtLastLearn: { type: Number, default: 0 },
    lastCrawledAt: { type: Date, default: null },
    notes: { type: String, default: "" },
    posts: [{ type: Schema.Types.ObjectId, ref: "KolPost" }],
    embeddings: [{ type: Schema.Types.ObjectId, ref: "KolEmbedding" }],
  },
  {
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" },
  }
);

// ── Compound Index ───────────────────────────────────────────────────────────

kolSchema.index({ platform: 1, handle: 1 }, { unique: true });
kolSchema.index({ isActive: 1, lastCrawledAt: 1 });

// ── Indexes for KolPost ─────────────────────────────────────────────────────

kolPostSchema.index({ kolId: 1, postedAt: -1 });
kolPostSchema.index({ status: 1, createdAt: -1 });

// ── Indexes for KolEmbedding ────────────────────────────────────────────────

kolEmbeddingSchema.index({ kolId: 1 });

// ── Models ────────────────────────────────────────────────────────────────────

export const Kol = model<IKol>("Kol", kolSchema);
export const KolPost = model<IKolPost>("KolPost", kolPostSchema);
export const KolEmbedding = model<IKolEmbedding>("KolEmbedding", kolEmbeddingSchema);

// ── Export Schemas for MongooseModule.forFeature ─────────────────────────────

export { kolSchema, kolPostSchema, kolEmbeddingSchema };
