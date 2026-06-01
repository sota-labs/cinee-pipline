/**
 * KOL Stream Worker — persistent process that connects to X Filtered Stream
 * for Tier S/A KOLs and pipes detected posts into the analyze/reply pipeline.
 *
 * Usage: npm run stream:kol
 */
import { connectDb } from "../db/connection.js";
import { closeRedis } from "../db/redis.js";
import { KolProfile } from "../db/models/KolProfile.js";
import { connect, disconnect, syncRules, updateKolIdMap } from "../services/kolStreamService.js";
import { processCrawlResults } from "../services/kolCrawlerService.js";
import { kolAnalyzerService } from "../services/kolAnalyzerService.js";
import { replyEngineService } from "../services/replyEngineService.js";
import { log } from "../utils/logger.js";

async function loadStreamKols() {
  return KolProfile.find({
    is_active: true,
    tier: { $in: ["S", "A"] },
  }).lean();
}

async function main() {
  await connectDb();
  log.info("[KolStreamWorker] Connected to MongoDB");

  const kols = await loadStreamKols();
  const kolIdMap = new Map(
    kols
      .filter(k => k.x_user_id)
      .map(k => [k.x_user_id!, String(k._id)]),
  );

  log.info(`[KolStreamWorker] Loaded ${kols.length} Tier S/A KOLs (${kolIdMap.size} with x_user_id)`);

  await syncRules(kols);

  await connect(async (rawPost, kolId) => {
    void (async () => {
      try {
        await processCrawlResults(kolId, [rawPost]);
        await kolAnalyzerService.analyzePendingPosts();
        await replyEngineService.runScheduledAFKReplies();
      } catch (err) {
        log.error(`[KolStreamWorker] Stream post pipeline error — kolId: ${kolId}, err: ${(err as Error).message}`);
      }
    })();
  }, kolIdMap);

  // Periodic rule sync every 6h to pick up KOL tier changes
  setInterval(async () => {
    try {
      const refreshed = await loadStreamKols();
      const refreshedMap = new Map(
        refreshed.filter(k => k.x_user_id).map(k => [k.x_user_id!, String(k._id)]),
      );
      await syncRules(refreshed);
      updateKolIdMap(refreshedMap);
    } catch (err) {
      log.error(`[KolStreamWorker] Periodic rule sync failed: ${(err as Error).message}`);
    }
  }, 6 * 60 * 60 * 1000);

  log.info("[KolStreamWorker] Started — stream active");
}

async function shutdown() {
  log.info("[KolStreamWorker] Shutting down…");
  disconnect();
  await closeRedis();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

main().catch(err => {
  log.error(`[KolStreamWorker] Fatal error: ${(err as Error).message}`);
  process.exit(1);
});
