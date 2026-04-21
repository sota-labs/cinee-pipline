/** KolCrawlCron — Periodic crawl job for all KOLs */
import { kolCrawlerService } from "../services/kolCrawlerService.js";
import { log } from "../utils/logger.js";

/**
 * Main entry point for cron job.
 * Schedule: every 30 minutes
 * Cron expression: 0,30 * * * *
 */
async function main(): Promise<void> {
  try {
    log.info("[KolCrawlCron] Starting scheduled crawl...");

    const results = await kolCrawlerService.crawlAllKols();

    const totalPostsFound = results.reduce((sum, r) => sum + r.postsFound, 0);
    const totalPostsSaved = results.reduce((sum, r) => sum + r.postsSaved, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

    log.info(
      `[KolCrawlCron] Completed: ${results.length} KOLs, ` +
        `${totalPostsFound} posts found, ${totalPostsSaved} saved, ${totalErrors} errors`,
    );

    // Exit successfully
    process.exit(0);
  } catch (error) {
    log.error(`[KolCrawlCron] Fatal error: ${(error as Error).message}`);
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
