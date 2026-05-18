/** OwnAccountLearnCron — Daily personality learning from own posts */
import { ownAccountService } from "../services/ownAccountService.js";
import { connectDb, disconnectDb } from "../db/connection.js";
import { log } from "../utils/logger.js";

/**
 * Main entry point for cron job.
 * Schedule: daily at 03:00 AM
 */
async function main(): Promise<void> {
  try {
    await connectDb();
    log.info("[OwnAccountLearnCron] Connected to DB. Starting personality learning...");

    const taskId = await ownAccountService.learnPersonality();

    if (taskId) {
      log.info(`[OwnAccountLearnCron] Queued learning task: ${taskId}`);
    } else {
      log.info("[OwnAccountLearnCron] Skipped — not enough posts");
    }

    await disconnectDb();
    process.exit(0);
  } catch (error) {
    log.error(`[OwnAccountLearnCron] Fatal error: ${(error as Error).message}`);
    await disconnectDb().catch(() => {});
    process.exit(1);
  }
}

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("ownAccountLearnCron.ts") ||
    process.argv[1].endsWith("ownAccountLearnCron.js"));

if (isMainModule) {
  main();
}

export { main as runOwnAccountLearnCron };
