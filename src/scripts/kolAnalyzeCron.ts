/** KolAnalyzeCron — Periodic analysis job for new posts */
import { kolAnalyzerService } from "../services/kolAnalyzerService.js";
import { log } from "../utils/logger.js";

/**
 * Main entry point for cron job.
 * Schedule: every 15 minutes
 */
async function main(): Promise<void> {
  try {
    log.info("[KolAnalyzeCron] Starting analysis job...");

    const result = await kolAnalyzerService.analyzePendingPosts();

    log.info(
      `[KolAnalyzeCron] Completed: ${result.queued} posts queued for analysis, ${result.errors} errors`,
    );

    process.exit(0);
  } catch (error) {
    log.error(`[KolAnalyzeCron] Fatal error: ${(error as Error).message}`);
    process.exit(1);
  }
}

// Run if called directly
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith("kolAnalyzeCron.ts") ||
  process.argv[1].endsWith("kolAnalyzeCron.js")
);

if (isMainModule) {
  main();
}

export { main as runKolAnalyzeCron };
