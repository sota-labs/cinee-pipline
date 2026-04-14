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
    const icon = r.status === "queued" ? "✅" : "❌";
    console.log(`${icon}  ${r.id}: ${r.status}`);
    if (r.taskId) console.log(`   taskId: ${r.taskId}`);
    if (r.error) console.log(`   error: ${r.error}`);
  }

  console.log("\n── Remaining OpenClaw Cron Jobs ──");
  console.log(listJobs());

  await disconnectDb();
  process.exit(0);
}

main();
