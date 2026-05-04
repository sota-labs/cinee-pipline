/** KolAFKReplyCron — Execute scheduled AFK replies */
import { replyEngineService } from "../services/replyEngineService.js";
import { connectDb, disconnectDb } from "../db/connection.js";
import { log } from "../utils/logger.js";

/**
 * Main entry point for cron job.
 * Schedule: every 10 minutes
 */
async function main(): Promise<void> {
  try {
    await connectDb();
    log.info("[KolAFKReplyCron] Connected to DB. Starting AFK reply job...");

    const result = await replyEngineService.runScheduledAFKReplies();

    log.info(
      `[KolAFKReplyCron] Completed: ${result.processed} processed, ` +
        `${result.succeeded} succeeded, ${result.failed} failed`,
    );

    await disconnectDb();
    process.exit(0);
  } catch (error) {
    log.error(`[KolAFKReplyCron] Fatal error: ${(error as Error).message}`);
    await disconnectDb().catch(() => {});
    process.exit(1);
  }
}

// Run if called directly
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith("kolAFKReplyCron.ts") ||
  process.argv[1].endsWith("kolAFKReplyCron.js")
);

if (isMainModule) {
  main();
}

export { main as runKolAFKReplyCron };
