/** SelfReplyCron — Process self-reply queues */
import { selfReplyService } from "../services/selfReplyService.js";
import { connectDb, disconnectDb } from "../db/connection.js";
import { log } from "../utils/logger.js";

/**
 * Main entry point for cron job.
 * Schedule: every 5 minutes
 */
async function main(): Promise<void> {
  try {
    await connectDb();
    log.info("[SelfReplyCron] Connected to DB. Starting self-reply job...");

    const result = await selfReplyService.processAllQueues();

    log.info(
      `[SelfReplyCron] Completed: ${result.processed} processed, ` +
        `${result.succeeded} succeeded, ${result.failed} failed`,
    );

    await disconnectDb();
    process.exit(0);
  } catch (error) {
    log.error(`[SelfReplyCron] Fatal error: ${(error as Error).message}`);
    await disconnectDb().catch(() => {});
    process.exit(1);
  }
}

// Run if called directly
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith("selfReplyCron.ts") ||
  process.argv[1].endsWith("selfReplyCron.js")
);

if (isMainModule) {
  main();
}

export { main as runSelfReplyCron };
