/** Standalone script: Twitter Engagement — called by OpenClaw cron. */
import { pipelineService } from "../services/pipelineService.js";
import { log } from "../utils/logger.js";

async function main() {
  log.info("=== TWITTER ENGAGEMENT (OpenClaw Scheduled) ===");
  const result = await pipelineService.runEngagement(10);
  log.info(`Result: ${JSON.stringify(result).slice(0, 300)}`);
  log.info("=== ENGAGEMENT COMPLETE ===");
  process.exit(0);
}

main().catch((e) => {
  log.error(`Fatal: ${e.message}`);
  process.exit(1);
});
