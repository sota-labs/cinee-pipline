/** KolAnalyzeCron — Periodic analysis job for new posts */
import { kolAnalyzerService } from "../services/kolAnalyzerService.js";
import { connectDb, disconnectDb } from "../db/connection.js";
import { log } from "../utils/logger.js";

/**
 * Main entry point for cron job.
 * Schedule: every 15 minutes
 */
async function main(): Promise<void> {
  try {
    await connectDb();
    log.info("[KolAnalyzeCron] Connected to DB. Starting analysis job...");

    const result = await kolAnalyzerService.analyzePendingPosts();

    log.info(
      `[KolAnalyzeCron] Completed: ${result.queued} posts queued for analysis, ${result.errors} errors`,
    );

    await disconnectDb();
    process.exit(0);
  } catch (error) {
    log.error(`[KolAnalyzeCron] Fatal error: ${(error as Error).message}`);
    await disconnectDb().catch(() => {});
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
