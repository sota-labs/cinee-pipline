/** Standalone script: Mention Check & Reply — called by OpenClaw cron. */
import { pipelineService } from "../services/pipelineService.js";
import { log } from "../utils/logger.js";

async function main() {
  log.info("=== MENTION CHECK (OpenClaw Scheduled) ===");
  const result = await pipelineService.runMentions();
  log.info(`Result: ${JSON.stringify(result).slice(0, 300)}`);
  log.info("=== MENTION CHECK COMPLETE ===");
  process.exit(0);
}

main().catch((e) => {
  log.error(`Fatal: ${e.message}`);
  process.exit(1);
});
