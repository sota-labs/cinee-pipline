/** KolAutoRejectCron — Auto-reject expired manual suggestions */
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
    log.info("[KolAutoRejectCron] Connected to DB. Checking for expired suggestions...");

    const result = await replyEngineService.runAutoRejectExpired();

    log.info(`[KolAutoRejectCron] Completed: ${result.rejected} suggestions auto-rejected`);

    await disconnectDb();
    process.exit(0);
  } catch (error) {
    log.error(`[KolAutoRejectCron] Fatal error: ${(error as Error).message}`);
    await disconnectDb().catch(() => {});
    process.exit(1);
  }
}

// Run if called directly
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith("kolAutoRejectCron.ts") ||
  process.argv[1].endsWith("kolAutoRejectCron.js")
);

if (isMainModule) {
  main();
}

export { main as runKolAutoRejectCron };
