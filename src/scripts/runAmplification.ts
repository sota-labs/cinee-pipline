/** Standalone script: AI Film Amplification — called by OpenClaw cron. */
import { pipelineService } from "../services/pipelineService.js";
import { log } from "../utils/logger.js";

async function main() {
  log.info("=== AI FILM AMPLIFICATION (OpenClaw Scheduled) ===");
  const result = await pipelineService.runAmplification(3);
  log.info(`Result: ${JSON.stringify(result).slice(0, 300)}`);
  log.info("=== AMPLIFICATION COMPLETE ===");
  process.exit(0);
}

main().catch((e) => {
  log.error(`Fatal: ${e.message}`);
  process.exit(1);
});
