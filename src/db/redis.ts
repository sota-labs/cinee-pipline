/** Redis singleton — backed by ioredis. */
import Redis from "ioredis";
import { settings } from "../config/settings.js";
import { log } from "../utils/logger.js";

let _client: Redis | null = null;

/**
 * Returns the shared Redis client, creating it on first call.
 * Connection errors are logged but do not crash the process.
 */
export function getRedis(): Redis {
  if (_client) return _client;

  _client = new Redis(settings.redisUrl, {
    lazyConnect: false,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => Math.min(times * 200, 3000),
  });

  _client.on("connect", () => log.info("Redis connected"));
  _client.on("error", (err: Error) => log.error(`Redis error: ${err.message}`));
  _client.on("close", () => log.warn("Redis connection closed"));

  return _client;
}

export async function closeRedis(): Promise<void> {
  if (_client) {
    await _client.quit().catch(() => {/* already closed */});
    _client = null;
  }
}
