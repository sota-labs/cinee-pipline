/** ReplyMemoryService — BM25 few-shot retrieval over past POSTED replies */
import { createHash } from "node:crypto";
import { log } from "../utils/logger.js";
import { Reply, EReplyStatus, EReplyPlatform, type IReply } from "../db/models/Reply.js";

const TOP_K = 3;

export interface IFewShotExample {
  reply_text: string;
  tone: string;
  parent_context: string;
  created_at: Date;
}

export interface IFewShotQuery {
  contextText: string;
  platform: EReplyPlatform;
  tone?: string;
  authorHandle?: string;
  topK?: number;
}

export async function findFewShotExamples(
  q: IFewShotQuery,
): Promise<IFewShotExample[]> {
  try {
    const k = q.topK ?? TOP_K;

    const baseFilter: Record<string, unknown> = {
      status: EReplyStatus.REPLIED,
      platform: q.platform,
      reply_content: { $exists: true, $ne: "" },
      ...(q.authorHandle ? { author_handle: { $ne: q.authorHandle } } : {}),
    };

    const textQuery: Record<string, unknown> = {
      $text: { $search: extractKeywords(q.contextText) },
    };
    const candidates = await Reply.find({ ...baseFilter, ...textQuery })
      .select("reply_content tone_used author_handle parent_post_url created_at")
      .sort({ score: { $meta: "textScore" }, created_at: -1 })
      .limit(k * 4)
      .lean();

    let pool = candidates;
    if (pool.length === 0) {
      pool = await Reply.find(baseFilter)
        .select("reply_content tone_used author_handle parent_post_url created_at")
        .sort({ created_at: -1 })
        .limit(k)
        .lean();
    }

    const seenHash = new Set<string>();
    const seenAuthor = new Set<string>();
    const out: IFewShotExample[] = [];

    const sorted = q.tone
      ? [
          ...pool.filter((c) => c.tone_used === q.tone),
          ...pool.filter((c) => c.tone_used !== q.tone),
        ]
      : pool;

    for (const c of sorted) {
      if (out.length >= k) break;
      const hash = createHash("sha256")
        .update(c.reply_content)
        .digest("hex")
        .slice(0, 16);
      if (seenHash.has(hash)) continue;
      if (seenAuthor.has(c.author_handle ?? "")) continue;
      seenHash.add(hash);
      seenAuthor.add(c.author_handle ?? "");
      out.push(toExample(c));
    }

    return out;
  } catch (err: unknown) {
    log.error(`[ReplyMemory] findFewShotExamples failed: ${(err as Error).message}`);
    return [];
  }
}

function toExample(c: {
  reply_content: string;
  tone_used: string;
  parent_post_url?: string;
  created_at: Date;
}): IFewShotExample {
  return {
    reply_text: c.reply_content,
    tone: c.tone_used,
    parent_context: c.parent_post_url ?? "(no parent context stored)",
    created_at: c.created_at,
  };
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "this", "that", "from", "have", "are", "was",
  "you", "your", "but", "not", "his", "her", "they", "their", "what", "all",
  "can", "had", "she", "him", "one", "our", "out", "day", "get", "use", "now",
  "how", "man", "new", "old", "see", "way", "may",
]);

export function extractKeywords(text: string): string {
  const words = text.toLowerCase().match(/[a-z0-9$]{3,}/g) ?? [];
  const unique = [...new Set(words)].filter((w) => !STOP_WORDS.has(w));
  return unique.slice(0, 10).map((w) => `"${w}"`).join(" ");
}

export type { IReply };
