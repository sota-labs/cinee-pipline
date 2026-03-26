/** Script: Register a SINGLE OpenClaw cron job by name.
 *
 * Usage:   npx tsx src/scripts/addJob.ts <job_name>
 * Example: npx tsx src/scripts/addJob.ts scrape_x_notifications
 *
 * Available jobs:
 *   - scrape_x_notifications
 *   - reply_x_notifications
 *   - research_and_draft_morning
 *   - research_and_draft_evening
 */
import { registerSingleJob, listJobs, getJobDefinitions } from "../services/schedulerService.js";

function main() {
  const jobName = process.argv[2];

  if (!jobName) {
    console.error("❌ Error: Please provide a job name.\n");
    console.log("Usage:  npx tsx src/scripts/addJob.ts <job_name>\n");
    console.log("Available jobs:");
    for (const job of getJobDefinitions()) {
      console.log(`  - ${job.name}  (${job.schedule})  ${job.description}`);
    }
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log(`║  Adding Job: ${jobName.padEnd(39)}║`);
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const result = registerSingleJob(jobName);
  const icon = result.status === "registered" ? "✅" : "❌";
  console.log(`${icon}  ${result.name}: ${result.status}`);
  if (result.output) console.log(`   output: ${result.output}`);
  if (result.error) console.log(`   error: ${result.error}`);

  console.log("\n── Current OpenClaw Cron Jobs ──");
  console.log(listJobs());

  process.exit(result.status === "registered" ? 0 : 1);
}

main();
