/**
 * Priority Account Service — "The Inner Circle"
 *
 * Scoring formulas:
 *   CS  = (F × w1) + (Q × w2) + (I × w3) − (D × w4)
 *   HCS = (CS × decayFactor) + manualBonus
 *
 *   F  = total interactions in 30d (likes + comments + shares)
 *   Q  = quality-weighted sum    (like=1pt, share=5pt, comment=10pt)
 *   I  = impact bonus from follower count
 *   D  = days since last_seen_at × 2  (raw decay cost)
 *   decayFactor = 0.95 ^ days_since_last_seen  (5 % per idle day)
 *   manualBonus = 100 if is_manual_priority
 *
 * Redis cache key pattern:
 *   pa:daily:{handle}:{YYYY-MM-DD}  →  Hash { likes, comments, shares }
 *   TTL: 32 days (auto-expires; cron also deletes the 31-day-old key explicitly)
 */

import { PriorityAccount, ERelationshipTier, IPriorityAccount } from "../db/models/PriorityAccount.js";
import { getRedis } from "../db/redis.js";
import { log } from "../utils/logger.js";

// ── Scoring weights ───────────────────────────────────────────────────────────

const W1 = 1;          // Frequency weight
const W2 = 1;          // Quality weight
const W3 = 1;          // Impact weight
const W4 = 1;          // Decay cost weight (subtracted in CS)
const DECAY_RATE = 0.95;
const MANUAL_BONUS = 100;

// ── Redis key helpers ─────────────────────────────────────────────────────────

const CACHE_PREFIX = "pa:daily";

/** TTL set on every daily hash key — 32 days gives 2 days of buffer beyond the window */
const CACHE_TTL_SECONDS = 32 * 24 * 60 * 60;

function toYMD(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function dailyCacheKey(handle: string, date: Date): string {
  return `${CACHE_PREFIX}:${handle}:${toYMD(date)}`;
}

/** Returns a Date for `daysAgo` days before today (midnight UTC). */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

// ── Impact lookup ─────────────────────────────────────────────────────────────

function impactBonus(followerCount: number): number {
  if (followerCount >= 100_000) return 50;
  if (followerCount >= 10_000) return 20;
  if (followerCount >= 1_000) return 10;
  return 0;
}

// ── Core scoring (pure) ───────────────────────────────────────────────────────

export function computeCS(
  likes: number,
  comments: number,
  shares: number,
  followerCount: number,
  lastSeenAt: Date | null,
): number {
  const F = likes + comments + shares;
  const Q = likes * 1 + comments * 10 + shares * 5;
  const I = impactBonus(followerCount);

  const daysSince = lastSeenAt
    ? Math.max(0, Math.floor((Date.now() - lastSeenAt.getTime()) / 86_400_000))
    : 0;

  const cs = F * W1 + Q * W2 + I * W3 - daysSince * 2 * W4;
  return Math.max(0, parseFloat(cs.toFixed(4)));
}

export function computeHCS(cs: number, isManual: boolean, lastSeenAt: Date | null): number {
  const daysSince = lastSeenAt
    ? Math.max(0, Math.floor((Date.now() - lastSeenAt.getTime()) / 86_400_000))
    : 0;
  const decayFactor = Math.pow(DECAY_RATE, daysSince);
  const hcs = cs * decayFactor + (isManual ? MANUAL_BONUS : 0);
  return Math.max(0, parseFloat(hcs.toFixed(4)));
}

export function computeTier(cs: number, isManual: boolean): ERelationshipTier {
  if (isManual) return ERelationshipTier.STRATEGIC;
  if (cs > 80) return ERelationshipTier.CLOSE_FRIEND;
  if (cs >= 50) return ERelationshipTier.ALLIED;
  return ERelationshipTier.STRANGER;
}

/** Recompute and persist CS, HCS, tier on an existing account document. */
export async function refreshScores(account: IPriorityAccount): Promise<IPriorityAccount> {
  const cs = computeCS(
    account.likes_30d,
    account.comments_30d,
    account.shares_30d,
    account.follower_count,
    account.last_seen_at,
  );
  account.closeness_score = cs;
  account.hybrid_score    = computeHCS(cs, account.is_manual_priority, account.last_seen_at);
  account.relationship_tier = computeTier(cs, account.is_manual_priority);
  await account.save();
  return account;
}

// ── Redis-backed interaction increment ───────────────────────────────────────

export interface IncStatsInput {
  /** @handle on X (leading @ is stripped automatically) */
  handle: string;
  likes?: number;
  comments?: number;
  shares?: number;
}

/**
 * Called by SCRAPE_PROMPT when new likes / comments / shares are detected.
 *
 * 1. HINCRBY daily cache key in Redis (creates key if absent), set 32-day TTL.
 * 2. $inc the corresponding counters in MongoDB + set last_seen_at = now.
 * 3. Recompute CS / HCS / tier and persist.
 *
 * Returns null if the handle is not found in priority_accounts.
 */
export async function incStats(input: IncStatsInput): Promise<IPriorityAccount | null> {
  const handle = input.handle.replace(/^@/, "").toLowerCase();
  const today  = new Date();
  const cacheKey = dailyCacheKey(handle, today);

  const likes    = input.likes    ?? 0;
  const comments = input.comments ?? 0;
  const shares   = input.shares   ?? 0;

  if (likes === 0 && comments === 0 && shares === 0) {
    return PriorityAccount.findOne({ handle });
  }

  // ── Redis: HINCRBY + refresh TTL ─────────────────────────────────────────
  try {
    const redis = getRedis();
    const pipe  = redis.pipeline();
    if (likes    > 0) pipe.hincrby(cacheKey, "likes",    likes);
    if (comments > 0) pipe.hincrby(cacheKey, "comments", comments);
    if (shares   > 0) pipe.hincrby(cacheKey, "shares",   shares);
    pipe.expire(cacheKey, CACHE_TTL_SECONDS);
    await pipe.exec();
  } catch (err: any) {
    // Redis failure must not block the DB write
    log.error(`[PriorityAccount] Redis incStats failed for ${handle}: ${err.message}`);
  }

  // ── MongoDB: $inc + last_seen_at (upsert if not exists) ─────────────────
  const incPayload: Record<string, number> = {};
  if (likes    > 0) incPayload.likes_30d    = likes;
  if (comments > 0) incPayload.comments_30d = comments;
  if (shares   > 0) incPayload.shares_30d   = shares;

  const account = await PriorityAccount.findOneAndUpdate(
    { handle },
    {
      $inc: incPayload,
      $set: { last_seen_at: today },
      $setOnInsert: {
        is_manual_priority: false,
        vibe_notes: "",
        follower_count: 0,
        closeness_score: 0,
        hybrid_score: 0,
        relationship_tier: ERelationshipTier.STRANGER,
      },
    },
    { new: true, upsert: true },
  );

  return refreshScores(account);
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export interface CreatePriorityAccountInput {
  handle: string;
  is_manual_priority?: boolean;
  vibe_notes?: string;
  follower_count?: number;
  likes_30d?: number;
  comments_30d?: number;
  shares_30d?: number;
  last_seen_at?: Date | string;
}

export async function createAccount(input: CreatePriorityAccountInput): Promise<IPriorityAccount> {
  const lastSeen = input.last_seen_at ? new Date(input.last_seen_at) : null;

  const likes     = input.likes_30d    ?? 0;
  const comments  = input.comments_30d ?? 0;
  const shares    = input.shares_30d   ?? 0;
  const followers = input.follower_count ?? 0;
  const isManual  = input.is_manual_priority ?? false;

  const cs   = computeCS(likes, comments, shares, followers, lastSeen);
  const hcs  = computeHCS(cs, isManual, lastSeen);
  const tier = computeTier(cs, isManual);

  return PriorityAccount.create({
    handle: input.handle,
    is_manual_priority: isManual,
    vibe_notes: input.vibe_notes ?? "",
    follower_count: followers,
    likes_30d: likes,
    comments_30d: comments,
    shares_30d: shares,
    ...(lastSeen ? { last_seen_at: lastSeen } : {}),
    closeness_score: cs,
    hybrid_score: hcs,
    relationship_tier: tier,
  });
}

export interface UpdatePriorityAccountInput {
  is_manual_priority?: boolean;
  vibe_notes?: string;
  follower_count?: number;
  likes_30d?: number;
  comments_30d?: number;
  shares_30d?: number;
  last_seen_at?: Date | string;
}

export async function updateAccount(
  id: string,
  input: UpdatePriorityAccountInput,
): Promise<IPriorityAccount | null> {
  const account = await PriorityAccount.findById(id);
  if (!account) return null;

  if (input.is_manual_priority !== undefined) account.is_manual_priority = input.is_manual_priority;
  if (input.vibe_notes         !== undefined) account.vibe_notes         = input.vibe_notes;
  if (input.follower_count     !== undefined) account.follower_count     = input.follower_count;
  if (input.likes_30d          !== undefined) account.likes_30d          = input.likes_30d;
  if (input.comments_30d       !== undefined) account.comments_30d       = input.comments_30d;
  if (input.shares_30d         !== undefined) account.shares_30d         = input.shares_30d;
  if (input.last_seen_at       !== undefined) account.last_seen_at       = new Date(input.last_seen_at);

  return refreshScores(account);
}

/** Record a single ad-hoc interaction by account ID (useful from the UI). */
export async function recordInteraction(
  id: string,
  type: "like" | "comment" | "share",
): Promise<IPriorityAccount | null> {
  const handle = (await PriorityAccount.findById(id).select("handle"))?.handle;
  if (!handle) return null;

  return incStats({ handle, likes: type === "like" ? 1 : 0, comments: type === "comment" ? 1 : 0, shares: type === "share" ? 1 : 0 });
}

/** Zero out 30d counters for a single account (called by the daily cron after rebuilding from Redis). */
export async function reset30dCounters(id: string): Promise<IPriorityAccount | null> {
  const account = await PriorityAccount.findById(id);
  if (!account) return null;

  account.likes_30d    = 0;
  account.comments_30d = 0;
  account.shares_30d   = 0;
  return refreshScores(account);
}

/** On-demand: re-score every account from current DB values (no Redis read). */
export async function recalculateAllScores(): Promise<{ updated: number }> {
  const accounts = await PriorityAccount.find({});
  await Promise.all(accounts.map((a) => refreshScores(a)));
  return { updated: accounts.length };
}

// ── Daily rolling-window cron job ─────────────────────────────────────────────

/**
 * Runs once every 24 hours (registered in src/index.ts via node-cron).
 *
 * For each priority account:
 *   1. Reads the last 30 daily Redis hash keys and sums their fields.
 *   2. Writes the resulting totals back to MongoDB as the authoritative 30d counters.
 *   3. Recomputes CS / HCS / tier.
 *   4. Deletes the 31-day-old Redis key (data now outside the window).
 *
 * This ensures the rolling window slides correctly: old interactions that
 * happened more than 30 days ago are no longer counted.
 */
export async function runDailyRollingWindowJob(): Promise<{ processed: number; errors: number }> {
  let processed = 0;
  let errors    = 0;

  const accounts = await PriorityAccount.find({});

  for (const account of accounts) {
    try {
      const redis = getRedis();

      // ── Sum stats across last 30 days ─────────────────────────────────────
      let totalLikes    = 0;
      let totalComments = 0;
      let totalShares   = 0;

      // Build all keys at once and use pipeline for efficiency
      const keys = Array.from({ length: 30 }, (_, i) => dailyCacheKey(account.handle, daysAgo(i)));
      const pipe  = redis.pipeline();
      keys.forEach((k) => pipe.hgetall(k));
      const results = await pipe.exec();

      if (results) {
        for (const [err, data] of results) {
          if (err || !data) continue;
          const day = data as Record<string, string>;
          totalLikes    += parseInt(day.likes    ?? "0", 10);
          totalComments += parseInt(day.comments ?? "0", 10);
          totalShares   += parseInt(day.shares   ?? "0", 10);
        }
      }

      // ── Persist updated 30d window ────────────────────────────────────────
      account.likes_30d    = totalLikes;
      account.comments_30d = totalComments;
      account.shares_30d   = totalShares;

      await refreshScores(account);

      // ── Evict the key that just slid out of the 30-day window ─────────────
      const expiredKey = dailyCacheKey(account.handle, daysAgo(31));
      await redis.del(expiredKey);

      processed++;
    } catch (err: any) {
      errors++;
      log.error(`[PriorityAccount] Daily job failed for ${account.handle}: ${err.message}`);
    }
  }

  return { processed, errors };
}

// ── Query helpers ─────────────────────────────────────────────────────────────

export interface ListAccountsFilter {
  tier?: ERelationshipTier;
  is_manual_priority?: boolean;
  limit?: number;
  skip?: number;
}

export async function listAccounts(
  filter: ListAccountsFilter = {},
): Promise<{ accounts: IPriorityAccount[]; total: number }> {
  const query: Record<string, unknown> = {};
  if (filter.tier !== undefined) query.relationship_tier = filter.tier;
  if (filter.is_manual_priority !== undefined) query.is_manual_priority = filter.is_manual_priority;

  const limit = filter.limit ?? 20;
  const skip  = filter.skip  ?? 0;

  const [accounts, total] = await Promise.all([
    PriorityAccount.find(query).sort({ hybrid_score: -1 }).skip(skip).limit(limit),
    PriorityAccount.countDocuments(query),
  ]);

  return { accounts, total };
}

export async function getAccountById(id: string): Promise<IPriorityAccount | null> {
  return PriorityAccount.findById(id);
}

export async function getAccountByHandle(handle: string): Promise<IPriorityAccount | null> {
  return PriorityAccount.findOne({ handle: handle.replace(/^@/, "").toLowerCase() });
}

export async function deleteAccount(id: string): Promise<boolean> {
  const result = await PriorityAccount.findByIdAndDelete(id);
  return !!result;
}
