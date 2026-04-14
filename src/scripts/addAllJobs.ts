/** Script: Register ALL OpenClaw cron jobs.
 *
 * Usage:   npx tsx src/scripts/addAllJobs.ts
 */
import { registerIsolatedJobs, listJobs } from "../services/schedulerService.js";
import { connectDb, disconnectDb } from "../db/connection.js";

async function main() {
  await connectDb();

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Adding ALL OpenClaw Cron Jobs                      ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const results = await registerIsolatedJobs();

  console.log("── Results ──");
  for (const r of results) {
    const icon = r.status === "queued" ? "✅" : "❌";
    console.log(`${icon}  ${r.name}: ${r.status}`);
    if (r.taskId) console.log(`   taskId: ${r.taskId}`);
    if (r.error) console.log(`   error: ${r.error}`);
  }

  console.log("\n── Current OpenClaw Cron Jobs ──");
  console.log(listJobs());

  await disconnectDb();
  process.exit(0);
}

main();
