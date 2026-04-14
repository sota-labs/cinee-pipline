/** Standalone script: register the two X-notification cron jobs in OpenClaw.
 *
 * Usage (run once):
 *   npx tsx src/scripts/setupCronJobs.ts
 *
 * After this, the OpenClaw daemon handles scheduling automatically.
 * Verify with:  openclaw cron list
 */
import { registerIsolatedJobs, listJobs } from "../services/schedulerService.js";
import { connectDb, disconnectDb } from "../db/connection.js";

async function main() {
  await connectDb();

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Registering OpenClaw Isolated Cron Jobs            ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const results = await registerIsolatedJobs();

  console.log("\n── Results ──");
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
