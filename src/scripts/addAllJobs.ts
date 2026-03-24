/** Script: Register ALL OpenClaw cron jobs.
 *
 * Usage:   npx tsx src/scripts/addAllJobs.ts
 */
import { registerIsolatedJobs, listJobs } from "../services/schedulerService.js";

function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Adding ALL OpenClaw Cron Jobs                      ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const results = registerIsolatedJobs();

  console.log("── Results ──");
  for (const r of results) {
    const icon = r.status === "registered" ? "✅" : "❌";
    console.log(`${icon}  ${r.name}: ${r.status}`);
    if (r.output) console.log(`   output: ${r.output}`);
    if (r.error) console.log(`   error: ${r.error}`);
  }

  console.log("\n── Current OpenClaw Cron Jobs ──");
  console.log(listJobs());

  process.exit(0);
}

main();
