/** Redis-based rate limiter — ported from rate_limiter.py. */
import Redis from "ioredis";
import { settings } from "../config/settings.js";

interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  "twitter:tweet": { maxRequests: 50, windowSeconds: 86400 },     // 50/day
  "twitter:reply": { maxRequests: 100, windowSeconds: 86400 },    // 100/day
  "twitter:like": { maxRequests: 200, windowSeconds: 86400 },     // 200/day
  "twitter:retweet": { maxRequests: 100, windowSeconds: 86400 },  // 100/day
  "twitter:search": { maxRequests: 180, windowSeconds: 900 },     // 180/15min
  "reddit:post": { maxRequests: 10, windowSeconds: 86400 },       // 10/day
  "reddit:comment": { maxRequests: 50, windowSeconds: 86400 },    // 50/day
  default: { maxRequests: 100, windowSeconds: 3600 },             // 100/hour
};

export class RateLimiter {
  private redis: Redis;

  constructor(redisUrl?: string) {
    this.redis = new Redis(redisUrl || settings.redisUrl);
  }

  async checkRateLimit(action: string): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
    const config = DEFAULT_LIMITS[action] || DEFAULT_LIMITS.default;
    const key = `ratelimit:${action}`;

    const current = await this.redis.get(key);
    const count = current ? parseInt(current, 10) : 0;
    const ttl = await this.redis.ttl(key);

    const allowed = count < config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - count);
    const resetIn = ttl > 0 ? ttl : config.windowSeconds;

    return { allowed, remaining, resetIn };
  }

  async recordAction(action: string): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
    const config = DEFAULT_LIMITS[action] || DEFAULT_LIMITS.default;
    const key = `ratelimit:${action}`;

    const current = await this.redis.get(key);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= config.maxRequests) {
      const ttl = await this.redis.ttl(key);
      return {
        allowed: false,
        remaining: 0,
        resetIn: ttl > 0 ? ttl : config.windowSeconds,
      };
    }

    const multi = this.redis.multi();
    multi.incr(key);

    if (!current) {
      multi.expire(key, config.windowSeconds);
    }

    await multi.exec();

    const newCount = count + 1;
    return {
      allowed: true,
      remaining: Math.max(0, config.maxRequests - newCount),
      resetIn: config.windowSeconds,
    };
  }

  async getRateLimitStatus(): Promise<Record<string, unknown>> {
    const status: Record<string, unknown> = {};

    for (const [action, config] of Object.entries(DEFAULT_LIMITS)) {
      if (action === "default") continue;
      const key = `ratelimit:${action}`;
      const current = await this.redis.get(key);
      const count = current ? parseInt(current, 10) : 0;
      const ttl = await this.redis.ttl(key);

      status[action] = {
        used: count,
        limit: config.maxRequests,
        remaining: Math.max(0, config.maxRequests - count),
        reset_in: ttl > 0 ? ttl : config.windowSeconds,
      };
    }

    return status;
  }

  async resetRateLimit(action: string): Promise<boolean> {
    const key = `ratelimit:${action}`;
    await this.redis.del(key);
    return true;
  }
}

export const rateLimiter = new RateLimiter();
