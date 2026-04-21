/** KOL Post Service — Database operations for KOL posts and related data */
import { Types } from "mongoose";
import { KolPost, KolEmbedding } from "../db/models/Kol.js";
import type { IKolPost, IPendingComment } from "../db/models/Kol.js";

// ── KolPost CRUD ──────────────────────────────────────────────────────────────

export async function createKolPost(data: Partial<IKolPost>) {
  return KolPost.create(data);
}

export async function findKolPostById(id: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  return KolPost.findById(id).lean();
}

export async function findKolPostByUrl(postUrl: string) {
  return KolPost.findOne({ postUrl }).lean();
}

export async function findKolPostsByKolId(kolId: string, options?: { status?: string }) {
  const query: Record<string, unknown> = { kolId };
  if (options?.status) query.status = options.status;
  return KolPost.find(query).lean();
}

export async function updateKolPost(id: string, data: Partial<IKolPost>) {
  if (!Types.ObjectId.isValid(id)) return null;
  return KolPost.findByIdAndUpdate(id, data, { new: true }).lean();
}

export async function countKolPosts(filter?: Record<string, unknown>) {
  return KolPost.countDocuments(filter ?? {});
}

export async function countKolPostsByKolId(kolId: string, options?: { status?: string }) {
  const query: Record<string, unknown> = { kolId };
  if (options?.status) query.status = options.status;
  return KolPost.countDocuments(query);
}

// ── KolPostProcessing (embedded) ──────────────────────────────────────────────

export async function upsertKolPostProcessing(
  kolPostId: string,
  data: {
    summary?: string;
    topComments?: unknown[];
    sentimentJson?: Record<string, unknown>;
    trendSummary?: string;
  }
) {
  if (!Types.ObjectId.isValid(kolPostId)) return null;
  
  return KolPost.findByIdAndUpdate(
    kolPostId,
    {
      processing: {
        kolPostId,
        summary: data.summary ?? "",
        topComments: data.topComments ?? [],
        sentimentJson: data.sentimentJson ?? {},
        trendSummary: data.trendSummary ?? "",
        processedAt: new Date(),
      },
    },
    { new: true }
  ).lean();
}

export async function findKolPostProcessing(kolPostId: string) {
  if (!Types.ObjectId.isValid(kolPostId)) return null;
  const post = await KolPost.findById(kolPostId, { processing: 1 }).lean();
  return post?.processing ?? null;
}

// ── PendingComment (embedded in KolPost) ────────────────────────────────────

export async function createPendingComment(
  kolPostId: string,
  data: Omit<IPendingComment, "createdAt" | "updatedAt">
) {
  if (!Types.ObjectId.isValid(kolPostId)) return null;
  
  const comment: IPendingComment = {
    ...data,
    kolPostId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  return KolPost.findByIdAndUpdate(
    kolPostId,
    { $push: { pendingComments: comment } },
    { new: true }
  ).lean();
}

export async function findPendingCommentById(commentId: string) {
  const post = await KolPost.findOne(
    { "pendingComments._id": new Types.ObjectId(commentId) },
    { pendingComments: 1, kolId: 1, postUrl: 1 }
  ).lean();
  
  if (!post) return null;
  
  const comment = post.pendingComments.find((c) => c._id?.toString() === commentId);
  if (!comment) return null;
  
  return {
    ...comment,
    kolPostId: post._id.toString(),
    kolId: post.kolId,
    postUrl: post.postUrl,
  };
}

export async function updatePendingComment(
  commentId: string,
  data: Partial<IPendingComment>
) {
  const updatePath = Object.keys(data).reduce(
    (acc, key) => {
      acc[`pendingComments.$.${key}`] = data[key as keyof IPendingComment];
      return acc;
    },
    {} as Record<string, unknown>
  );
  
  return KolPost.findOneAndUpdate(
    { "pendingComments._id": new Types.ObjectId(commentId) },
    { $set: updatePath },
    { new: true }
  ).lean();
}

export async function updatePendingCommentsByKolPostId(
  kolPostId: string,
  filter: Partial<IPendingComment>,
  data: Partial<IPendingComment>
) {
  if (!Types.ObjectId.isValid(kolPostId)) return;
  
  const setPath: Record<string, unknown> = {};
  Object.keys(data).forEach((key) => {
    setPath[`pendingComments.$[elem].${key}`] = data[key as keyof IPendingComment];
  });
  
  const arrayFilters: Record<string, unknown>[] = [{ "elem.kolPostId": kolPostId }];
  Object.keys(filter).forEach((key) => {
    arrayFilters[0][`elem.${key}`] = filter[key as keyof IPendingComment];
  });
  
  await KolPost.updateMany({ _id: kolPostId }, { $set: setPath }, { arrayFilters });
}

export async function countPendingComments(filter?: Partial<IPendingComment>) {
  const matchStage: Record<string, unknown> = {};
  if (filter) {
    Object.keys(filter).forEach((key) => {
      matchStage[`pendingComments.${key}`] = filter[key as keyof IPendingComment];
    });
  }
  
  const result = await KolPost.aggregate([
    { $match: matchStage },
    { $unwind: "$pendingComments" },
    { $match: matchStage },
    { $count: "total" },
  ]);
  
  return result[0]?.total ?? 0;
}

export async function findPendingCommentsByKolPostId(
  kolPostId: string,
  filter?: Partial<IPendingComment>
) {
  if (!Types.ObjectId.isValid(kolPostId)) return [];
  
  const post = await KolPost.findById(kolPostId, { pendingComments: 1 }).lean();
  if (!post?.pendingComments) return [];
  
  if (!filter) return post.pendingComments;
  
  return post.pendingComments.filter((c) =>
    Object.keys(filter).every((key) => c[key as keyof IPendingComment] === filter[key as keyof IPendingComment])
  );
}

// ── KolEmbedding ─────────────────────────────────────────────────────────────

export async function createKolEmbedding(data: {
  kolId: string;
  content: string;
  embedding: number[];
  postedAt: Date;
}) {
  return KolEmbedding.create({
    ...data,
    createdAt: new Date(),
  });
}

export async function findKolEmbeddingsByKolId(kolId: string, limit = 200) {
  return KolEmbedding.find({ kolId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}
