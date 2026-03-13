/** Memory Tools using ioredis — ported from memory_tools.py. */
import Redis from "ioredis";
import { settings } from "../config/settings.js";

let redisClient: Redis | null = null;

function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(settings.redisUrl);
  }
  return redisClient;
}

export async function storeMemory(
  key: string,
  content: string,
  metadata?: Record<string, unknown>,
  ttl?: number
): Promise<Record<string, unknown>> {
  const client = getRedisClient();
  try {
    const memoryData = {
      content,
      metadata: metadata || {},
      timestamp: new Date().toISOString(),
    };

    const fullKey = `memory:${key}`;
    await client.set(fullKey, JSON.stringify(memoryData));

    if (ttl) {
      await client.expire(fullKey, ttl);
    }

    await client.sadd("memory:index", key);

    return { success: true, key, stored_at: memoryData.timestamp };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function retrieveMemory(key: string): Promise<Record<string, unknown>> {
  const client = getRedisClient();
  try {
    const fullKey = `memory:${key}`;
    const data = await client.get(fullKey);

    if (data) {
      return { success: true, memory: JSON.parse(data) };
    }
    return { success: false, error: "Memory not found" };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function searchMemories(
  query: string,
  limit = 10
): Promise<Record<string, unknown>[]> {
  const client = getRedisClient();
  try {
    const results: Record<string, unknown>[] = [];
    const queryLower = query.toLowerCase();
    let cursor = "0";

    do {
      const [nextCursor, keys] = await client.scan(cursor, "MATCH", "memory:*", "COUNT", 50);
      cursor = nextCursor;

      for (const key of keys) {
        if (results.length >= limit) break;
        if (key === "memory:index") continue;

        const data = await client.get(key);
        if (data) {
          const memory = JSON.parse(data);
          const content = (memory.content || "").toLowerCase();
          const cleanKey = key.replace("memory:", "");

          if (content.includes(queryLower) || cleanKey.toLowerCase().includes(queryLower)) {
            results.push({
              key: cleanKey,
              content: memory.content,
              metadata: memory.metadata,
              timestamp: memory.timestamp,
            });
          }
        }
      }
    } while (cursor !== "0" && results.length < limit);

    return results;
  } catch (e: any) {
    return [{ error: e.message }];
  }
}

export async function storeContentHistory(
  contentType: string,
  content: string,
  tweetId?: string | null,
  metrics?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const client = getRedisClient();
  try {
    const timestamp = new Date().toISOString();
    const historyKey = `history:${timestamp}`;

    const historyData = {
      content_type: contentType,
      content,
      tweet_id: tweetId ?? null,
      metrics: metrics || {},
      timestamp,
    };

    await client.set(historyKey, JSON.stringify(historyData));
    await client.zadd("history:timeline", Date.now(), historyKey);

    return { success: true, history_key: historyKey };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function getRecentHistory(count = 10): Promise<Record<string, unknown>[]> {
  const client = getRedisClient();
  try {
    const recentKeys = await client.zrevrange("history:timeline", 0, count - 1);
    const results: Record<string, unknown>[] = [];

    for (const key of recentKeys) {
      const data = await client.get(key);
      if (data) results.push(JSON.parse(data));
    }

    return results;
  } catch (e: any) {
    return [{ error: e.message }];
  }
}

export async function storeEngagementPattern(
  patternType: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const client = getRedisClient();
  try {
    const patternKey = `pattern:${patternType}`;
    const existing = await client.get(patternKey);

    let patternData: Record<string, unknown>;

    if (existing) {
      patternData = JSON.parse(existing);
      (patternData.data as any[]).push({
        ...data,
        timestamp: new Date().toISOString(),
      });
    } else {
      patternData = {
        pattern_type: patternType,
        data: [{ ...data, timestamp: new Date().toISOString() }],
      };
    }

    await client.set(patternKey, JSON.stringify(patternData));
    return { success: true, pattern_type: patternType };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function getEngagementPatterns(
  patternType?: string
): Promise<Record<string, unknown>> {
  const client = getRedisClient();
  try {
    if (patternType) {
      const key = `pattern:${patternType}`;
      const data = await client.get(key);
      if (data) return { success: true, pattern: JSON.parse(data) };
      return { success: false, error: "Pattern not found" };
    }

    const patternKeys = await client.keys("pattern:*");
    const patterns: Record<string, unknown> = {};

    for (const key of patternKeys) {
      const data = await client.get(key);
      if (data) {
        const pType = key.replace("pattern:", "");
        patterns[pType] = JSON.parse(data);
      }
    }

    return { success: true, patterns };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
