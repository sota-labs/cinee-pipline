/** KOL Service — Business logic for Key Opinion Leader management */
import OpenAI from "openai";
import { Types } from "mongoose";
import { Kol, KolPost, KolEmbedding } from "../db/models/Kol.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── CRUD Operations ─────────────────────────────────────────────────────────

export async function createKol(data: {
  handle: string;
  platform?: string;
  displayName?: string;
  profileUrl?: string;
  isActive?: boolean;
}) {
  const handle = data.handle.replace(/^@/, "").toLowerCase();
  const platform = data.platform ?? "x";
  
  // Check duplicate
  const existing = await Kol.findOne({ platform, handle });
  if (existing) {
    throw new Error(`KOL @${handle} on ${platform} already exists`);
  }
  
  const kol = await Kol.create({
    ...data,
    handle,
    platform,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  
  return kol;
}

export async function findKols(filters: {
  platform?: string;
  isActive?: boolean;
  q?: string;
  limit?: number;
  skip?: number;
}) {
  const { platform, isActive, q, limit = 20, skip = 0 } = filters;
  const query: Record<string, unknown> = {};
  
  if (platform) query.platform = platform;
  if (isActive !== undefined) query.isActive = isActive;
  if (q) query.handle = { $regex: q, $options: "i" };
  
  const [data, total] = await Promise.all([
    Kol.find(query).skip(skip).limit(limit).sort({ createdAt: -1 }).lean(),
    Kol.countDocuments(query),
  ]);
  
  return { data, total, limit, skip };
}

export async function findKolById(id: string) {
  return Kol.findById(id).lean();
}

export async function updateKol(id: string, data: Record<string, unknown>) {
  if (data.handle) {
    data.handle = (data.handle as string).replace(/^@/, "").toLowerCase();
  }
  data.updatedAt = new Date();
  
  return Kol.findByIdAndUpdate(id, data, { new: true }).lean();
}

export async function updateManyKols(ids: string[], data: Record<string, unknown>) {
  const objectIds = ids.filter(id => Types.ObjectId.isValid(id)).map(id => new Types.ObjectId(id));
  if (objectIds.length === 0) return null;
  
  data.updatedAt = new Date();
  return Kol.updateMany({ _id: { $in: objectIds } }, { $set: data });
}

export async function deleteKol(id: string) {
  return Kol.findByIdAndDelete(id).lean();
}

export async function findActiveKols() {
  return Kol.find({ isActive: true }).sort({ lastCrawledAt: 1 }).lean();
}

export async function findKolsDueForCrawl(cutoff: Date) {
  return Kol.find({
    isActive: true,
    $or: [{ lastCrawledAt: { $exists: false } }, { lastCrawledAt: { $lt: cutoff } }],
  })
    .sort({ lastCrawledAt: 1 })
    .lean();
}

export async function markKolCrawled(id: string) {
  return Kol.findByIdAndUpdate(id, { lastCrawledAt: new Date() }, { new: true }).lean();
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getKolStats(id: string) {
  const kol = await Kol.findById(id).lean();
  if (!kol) return null;
  
  const [totalPosts, pendingPosts] = await Promise.all([
    KolPost.countDocuments({ kolId: id }),
    KolPost.countDocuments({ kolId: id, status: "NEW" }),
  ]);
  
  return {
    kol,
    stats: {
      totalPosts,
      pendingPosts,
      lastCrawledAt: kol.lastCrawledAt,
      styleLastLearnedAt: kol.styleLastLearnedAt,
      writingSamplesCount: kol.writingSamples?.length ?? 0,
    },
  };
}

// ── Style Learning ────────────────────────────────────────────────────────────

interface StyleLearnResult {
  style_summary: string;
  personality_notes: string;
  slang_vocab: string[];
}

export async function analyzeKolStyle(kolId: string, samples: string[]): Promise<StyleLearnResult> {
  if (samples.length < 3) {
    return { style_summary: "", personality_notes: "", slang_vocab: [] };
  }
  
  const joined = samples.slice(0, 50).map((s, i) => `[${i + 1}] ${s}`).join("\n\n");
  
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Analyze these posts and return JSON with:
{
  "style_summary": "1-2 sentence description of writing style, sentence length, punctuation habits",
  "personality_notes": "tone, stance, recurring themes, what topics they care about",
  "slang_vocab": ["array", "of", "signature", "words", "or", "phrases"]
}`,
      },
      { role: "user", content: `Analyze these ${samples.length} posts:\n\n${joined}` },
    ],
  });
  
  const raw = response.choices[0].message.content ?? "{}";
  const result = JSON.parse(raw) as StyleLearnResult;
  return result;
}

export async function updateKolStyle(kolId: string, styleData: {
  styleSummary?: string;
  personalityNotes?: string;
  slangVocab?: string[];
  writingSamples?: string[];
}) {
  const updateData: Record<string, unknown> = {
    styleLastLearnedAt: new Date(),
  };
  
  if (styleData.styleSummary) updateData.styleSummary = styleData.styleSummary;
  if (styleData.personalityNotes) updateData.personalityNotes = styleData.personalityNotes;
  if (styleData.slangVocab) updateData.slangVocab = styleData.slangVocab;
  if (styleData.writingSamples) {
    const kol = await Kol.findById(kolId).lean();
    if (kol) {
      const merged = [...(kol.writingSamples ?? []), ...styleData.writingSamples].slice(-50);
      updateData.writingSamples = merged;
    }
  }
  
  return Kol.findByIdAndUpdate(kolId, updateData, { new: true }).lean();
}

// ── Embeddings & Similarity ───────────────────────────────────────────────────

export async function storeKolEmbedding(kolId: string, content: string, postedAt: Date) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: content,
  });
  
  return KolEmbedding.create({
    kolId,
    content,
    embedding: response.data[0].embedding,
    postedAt,
    createdAt: new Date(),
  });
}

interface FewShotExample {
  content: string;
  similarity: number;
}

export async function findSimilarKolExamples(
  kolId: string,
  queryText: string,
  topK = 3
): Promise<FewShotExample[]> {
  const queryResponse = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: queryText,
  });
  const queryVec = queryResponse.data[0].embedding;
  
  const embeddings = await KolEmbedding.find({ kolId })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  
  const scored = embeddings.map((e) => ({
    content: e.content,
    similarity: cosineSimilarity(queryVec, e.embedding),
  }));
  
  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] ** 2;
    normB += b[i] ** 2;
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Writing Samples ───────────────────────────────────────────────────────────

export async function appendWritingSamples(id: string, samples: string[], maxSamples = 100) {
  const kol = await Kol.findById(id).lean();
  if (!kol) return null;
  
  const merged = [...(kol.writingSamples ?? []), ...samples].slice(-maxSamples);
  return Kol.findByIdAndUpdate(id, { writingSamples: merged }, { new: true }).lean();
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const MIN_SAMPLES_FOR_STYLE_LEARN = 10;
export const MAX_WRITING_SAMPLES = 50;
