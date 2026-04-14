/** Script: Remove ALL OpenClaw cron jobs.
 *
 * Usage:   npx tsx src/scripts/removeAllJobs.ts
 */
import { removeAllJobs, listJobs } from "../services/schedulerService.js";
import { connectDb, disconnectDb } from "../db/connection.js";

async function main() {
  await connectDb();

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Removing ALL OpenClaw Cron Jobs                    ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const results = await removeAllJobs();

  console.log("── Results ──");
  for (const r of results) {
    const icon = r.status === "removed" || r.status === "no_jobs" ? "✅" : "❌";
    console.log(`${icon}  ${JSON.stringify(r)}`);
  }

  console.log("\n── Remaining OpenClaw Cron Jobs ──");
  const { jobs, total } = await listJobs();
  console.log(`Total: ${total}`);
  for (const job of jobs) {
    console.log(`  ${job.name} — ${job.status} (${job.createdAt})`);
  }

  await disconnectDb();
  process.exit(0);
}

main();
