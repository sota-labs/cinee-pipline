/** Script: Remove ALL OpenClaw cron jobs.
 *
 * Usage:   npx tsx src/scripts/removeAllJobs.ts
 */
import { removeAllJobs, listJobs } from "../services/schedulerService.js";

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Removing ALL OpenClaw Cron Jobs                    ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const results = await removeAllJobs();

  console.log("── Results ──");
  for (const r of results) {
    const icon = r.status === "removed" ? "✅" : "❌";
    console.log(`${icon}  ${r.name}: ${r.status}`);
    if (r.output) console.log(`   output: ${r.output}`);
    if (r.error) console.log(`   error: ${r.error}`);
  }

  console.log("\n── Remaining OpenClaw Cron Jobs ──");
  console.log(listJobs());

  process.exit(0);
}

main();
