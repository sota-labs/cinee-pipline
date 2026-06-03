/** AutoLearnCron — Periodic auto-learn trigger (24h rate-limited). */
import { ownAccountService } from "../services/ownAccountService.js";
import { connectDb, disconnectDb } from "../db/connection.js";
import { log } from "../utils/logger.js";

async function main(): Promise<void> {
  try {
    await connectDb();
    log.info("[AutoLearnCron] Triggering auto-learn…");
    const taskId = await ownAccountService.autoLearnPersonality();
    if (taskId) {
      log.info(`[AutoLearnCron] Queued: ${taskId}`);
    } else {
      log.info("[AutoLearnCron] Skipped (rate-limited or no eligible posts)");
    }
    await disconnectDb();
    process.exit(0);
  } catch (error) {
    log.error(`[AutoLearnCron] Fatal: ${(error as Error).message}`);
    await disconnectDb().catch(() => {});
    process.exit(1);
  }
}

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("autoLearnCron.ts") ||
    process.argv[1].endsWith("autoLearnCron.js"));
if (isMainModule) main();
export { main as runAutoLearnCron };
