/** Standalone script: register the two X-notification cron jobs in OpenClaw.
 *
 * Usage (run once):
 *   npx tsx src/scripts/setupCronJobs.ts
 *
 * After this, the OpenClaw daemon handles scheduling automatically.
 * Verify with:  openclaw cron list
 */
import { registerIsolatedJobs, listJobs } from "../services/schedulerService.js";

function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Registering OpenClaw Isolated Cron Jobs            ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const results = registerIsolatedJobs();

  console.log("\n── Results ──");
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
