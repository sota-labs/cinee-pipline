/** Standalone script: Daily Planning — called by OpenClaw cron. */
import { pipelineService } from "../services/pipelineService.js";
import { log } from "../utils/logger.js";

async function main() {
  log.info("=== DAILY PLANNING (OpenClaw Scheduled) ===");
  const result = await pipelineService.runDailyStrategy();
  log.info(`Result: ${JSON.stringify(result).slice(0, 300)}`);
  log.info("=== DAILY PLANNING COMPLETE ===");
  process.exit(0);
}

main().catch((e) => {
  log.error(`Fatal: ${e.message}`);
  process.exit(1);
});
