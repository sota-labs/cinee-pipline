/** kolScheduleService — KOL crawl schedule logic, extracted from kolDaemon for testability */
import pLimit from "p-limit";
import { log } from "../utils/logger.js";
import {
  KolSettings,
  isWithinPrimeWindow,
} from "../db/models/KolSettings.js";
import { KolProfile } from "../db/models/KolProfile.js";
import {
  createBatchCrawlTasks,
  kolCrawlerService,
} from "./kolCrawlerService.js";
import { XRateLimitError } from "./platforms/x/xApiClient.js";

// ── Mutexes (in-process only) ───────────────────────────────────────────────

let isPrimePolling = false;
// Keyed by sorted tier string (e.g. "A,S", "B") so different tier groups don't block each other
const activeBatchGroups = new Set<string>();

// ── Prime Polling (Tier S via X API) ────────────────────────────────────────

export interface IRunPrimePollingResult {
  polled: number;
  /** True when the run was skipped due to another run in progress. */
  skipped: boolean;
  /** True when the run short-circuited because the current time is outside the prime window. */
  outsideWindow: boolean;
}

/** Poll Tier S KOLs via X API; only fires when the current time is within `prime_window`. */
export async function runPrimePolling(): Promise<IRunPrimePollingResult> {
  if (isPrimePolling) {
    log.warn("[KolSchedule] Prime poll already in progress, skipping tick");
    return { polled: 0, skipped: true, outsideWindow: false };
  }
  isPrimePolling = true;
  try {
    const settings = await KolSettings.getSettings();
    const now = new Date();
    if (!isWithinPrimeWindow(settings.prime_window, now)) {
      log.debug("[KolSchedule] Outside prime window, skipping Tier S poll");
      return { polled: 0, skipped: false, outsideWindow: true };
    }

    const minTrust = settings.safety.min_kol_trust_score;
    const cutoff = new Date(Date.now() - settings.tier_crawl_intervals.S * 60_000);
    const kols = await KolProfile.find({
      is_active: true,
      reputation_score: { $gte: minTrust },
      tier: "S",
      $or: [{ last_crawled_at: null }, { last_crawled_at: { $lte: cutoff } }],
    });

    if (kols.length === 0) {
      log.info("[KolSchedule] Prime poll — no Tier S KOLs due");
      return { polled: 0, skipped: false, outsideWindow: false };
    }

    log.info(`[KolSchedule] Prime poll — ${kols.length} Tier S KOLs (concurrency: ${settings.crawl_concurrency})`);

    const limit = pLimit(settings.crawl_concurrency);
    let rateLimited = false;
    const results = await Promise.allSettled(
      kols.map((kol) =>
        limit(async () => {
          if (rateLimited) return null;
          await kolCrawlerService.crawlKol(kol, { limit: settings.max_posts_per_crawl });
          return kol.handle;
        }),
      ),
    );

    let count = 0;
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) count++;
      else if (r.status === "rejected" && r.reason instanceof XRateLimitError) {
        rateLimited = true;
        log.warn("[KolSchedule] Rate limit hit during prime poll, stopping batch");
      } else if (r.status === "rejected") {
        log.error(`[KolSchedule] Prime poll failure: ${(r.reason as Error).message}`);
      }
    }
    return { polled: count, skipped: false, outsideWindow: false };
  } finally {
    isPrimePolling = false;
  }
}

// ── OpenClaw Batch Crawl ────────────────────────────────────────────────────

export interface IRunBatchCrawlResult {
  created: number;
  skipped: number;
  /** True when the run was skipped due to another batch in progress. */
  busy: boolean;
}

/** Create OpenClaw batch Tasks for the given tiers. Skips when the same tier group is already running.
 *  Tier S is skipped when the current time is within the prime window (X API polling covers it).
 *  Mutex is keyed on the original `tiers` argument so callers with mixed arrays (e.g. ["S","A"])
 *  always acquire/release the same key regardless of prime-window filtering. */
export async function runBatchCrawl(
  tiers: Array<"S" | "A" | "B" | "C">,
): Promise<IRunBatchCrawlResult> {
  const groupKey = [...tiers].sort().join(",");
  if (activeBatchGroups.has(groupKey)) {
    log.warn(`[KolSchedule] Batch crawl [${tiers.join(",")}] skipped — another batch is in progress`);
    return { created: 0, skipped: 0, busy: true };
  }

  let effectiveTiers = tiers;
  if (tiers.includes("S")) {
    const settings = await KolSettings.getSettings();
    if (isWithinPrimeWindow(settings.prime_window)) {
      effectiveTiers = tiers.filter((t) => t !== "S");
      log.debug("[KolSchedule] Batch crawl — Tier S skipped (within prime window)");
      if (effectiveTiers.length === 0) {
        return { created: 0, skipped: 0, busy: false };
      }
    }
  }

  activeBatchGroups.add(groupKey);
  try {
    const result = await createBatchCrawlTasks(effectiveTiers);
    return { created: result.tasksCreated, skipped: result.skipped.length, busy: false };
  } finally {
    activeBatchGroups.delete(groupKey);
  }
}

// ── Test helpers ────────────────────────────────────────────────────────────

/** Reset mutexes — test-only. */
export function _resetMutexesForTests(): void {
  isPrimePolling = false;
  activeBatchGroups.clear();
}
