/** Standalone script: Reddit Discussion — called by OpenClaw cron. */
import { pipelineService } from "../services/pipelineService.js";
import { log } from "../utils/logger.js";

async function main() {
  log.info("=== REDDIT DISCUSSION (OpenClaw Scheduled) ===");
  const result = await pipelineService.runReddit(5);
  log.info(`Result: ${JSON.stringify(result).slice(0, 300)}`);
  log.info("=== REDDIT DISCUSSION COMPLETE ===");
  process.exit(0);
}

main().catch((e) => {
  log.error(`Fatal: ${e.message}`);
  process.exit(1);
});
