/** KolCrawlCron — Periodic crawl job for all KOLs (parallel tasks, fire-and-forget) */
import { crawlAllKolsSequential } from "../services/kolCrawlerService.js";
import { connectDb, disconnectDb } from "../db/connection.js";
import { log } from "../utils/logger.js";

/**
 * Main entry point for cron job.
 * Schedule: every 4 hours — cron: 0 *-slash-4 * * *
 */
async function main(): Promise<void> {
  try {
    await connectDb();
    log.info("[KolCrawlCron] Connected to DB. Spawning crawl tasks...");

    const result = await crawlAllKolsSequential();

    log.info(
      `[KolCrawlCron] Completed: spawned ${result.tasksCreated} tasks for ${result.handles.length} handles`,
    );

    await disconnectDb();
    process.exit(0);
  } catch (error) {
    log.error(`[KolCrawlCron] Fatal error: ${(error as Error).message}`);
    await disconnectDb().catch(() => {});
    process.exit(1);
  }
}

// Run if called directly (check for ESM or CommonJS)
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith("kolCrawlCron.ts") ||
  process.argv[1].endsWith("kolCrawlCron.js")
);

if (isMainModule) {
  main();
}

export { main as runKolCrawlCron };
