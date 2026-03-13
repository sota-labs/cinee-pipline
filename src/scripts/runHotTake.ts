/** Standalone script: CEO Hot Take — called by OpenClaw cron. */
import { pipelineService } from "../services/pipelineService.js";
import { log } from "../utils/logger.js";

async function main() {
  log.info("=== CEO HOT TAKE (OpenClaw Scheduled) ===");
  const result = await pipelineService.runHotTake();
  log.info(`Result: ${JSON.stringify(result).slice(0, 300)}`);
  log.info("=== HOT TAKE COMPLETE ===");
  process.exit(0);
}

main().catch((e) => {
  log.error(`Fatal: ${e.message}`);
  process.exit(1);
});
