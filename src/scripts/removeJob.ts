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
import { connectDb, disconnectDb } from "../db/connection.js";

async function main() {
  const jobId = process.argv[2];

  if (!jobId) {
    console.error("❌ Error: Please provide a job ID.\n");
    console.log("Usage:  npx tsx src/scripts/removeJob.ts <job_id>\n");
    console.log("Available jobs:");
    const defs = await getJobDefinitions();
    for (const job of defs) {
      console.log(`  - ${job.name}  (${job.schedule})  ${job.description}`);
    }
    process.exit(1);
  }

  await connectDb();

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log(`║  Removing Job: ${jobId.padEnd(37)}║`);
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const result = await removeSingleJob(jobId);
  const icon = result.status === "queued" ? "✅" : "❌";
  console.log(`${icon}  ${result.id}: ${result.status}`);
  if (result.taskId) console.log(`   taskId: ${result.taskId}`);
  if (result.error) console.log(`   error: ${result.error}`);

  console.log("\n── Remaining OpenClaw Cron Jobs ──");
  console.log(listJobs());

  await disconnectDb();
  process.exit(result.status === "queued" ? 0 : 1);
}

main();
