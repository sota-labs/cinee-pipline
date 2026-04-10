/** Script: Remove a SINGLE OpenClaw cron job by name.
 *
 * Usage:   npx tsx src/scripts/removeJob.ts <job_name>
 * Example: npx tsx src/scripts/removeJob.ts scrape_x_notifications
 *
 * Available jobs:
 *   - scrape_x_notifications
 *   - reply_x_notifications
 *   - research_and_draft_morning
 *   - research_and_draft_evening
 */
import { removeSingleJob, listJobs, getJobDefinitions } from "../services/schedulerService.js";

async function main() {
  const jobName = process.argv[2];

  if (!jobName) {
    console.error("❌ Error: Please provide a job name.\n");
    console.log("Usage:  npx tsx src/scripts/removeJob.ts <job_name>\n");
    console.log("Available jobs:");
    const defs = await getJobDefinitions();
    for (const job of defs) {
      console.log(`  - ${job.name}  (${job.schedule})  ${job.description}`);
    }
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log(`║  Removing Job: ${jobName.padEnd(37)}║`);
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const result = await removeSingleJob(jobName);
  const icon = result.status === "removed" ? "✅" : "❌";
  console.log(`${icon}  ${result.name}: ${result.status}`);
  if (result.output) console.log(`   output: ${result.output}`);
  if (result.error) console.log(`   error: ${result.error}`);

  console.log("\n── Remaining OpenClaw Cron Jobs ──");
  console.log(listJobs());

  process.exit(result.status === "removed" ? 0 : 1);
}

main();
