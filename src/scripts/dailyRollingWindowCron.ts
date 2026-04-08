/**
 * Standalone daemon — Priority Account daily rolling-window job.
 *
 * Runs at 03:00 ICT every day via node-cron.
 * Can also be triggered immediately with the --run-now flag.
 *
 * Usage:
 *   npm run cron:add:daily-rolling          # start daemon (fires at 03:00 ICT daily)
 *   npm run cron:add:daily-rolling -- --run-now  # also fire once on startup
 */
import cron from "node-cron";
import { connectDb } from "../db/connection.js";
import { closeRedis } from "../db/redis.js";
import { log } from "../utils/logger.js";
import { runDailyRollingWindowJob } from "../services/priorityAccountService.js";

const RUN_NOW = process.argv.includes("--run-now");

async function execute() {
  log.info("[DailyRollingWindow] Job starting…");
  try {
    const { processed, errors } = await runDailyRollingWindowJob();
    log.info(
      `[DailyRollingWindow] Done — processed: ${processed}, errors: ${errors}`,
    );
  } catch (err: any) {
    log.error(`[DailyRollingWindow] Job crashed: ${err.message}`);
  }
}

async function startDaemon() {
  await connectDb();
  log.info("[DailyRollingWindow] Connected to MongoDB.");

  if (RUN_NOW) {
    await execute();
  }

  cron.schedule(
    "0 0 * * *",
    execute,
    { timezone: "UTC" },
  );

  log.info("[DailyRollingWindow] Daemon ready — scheduled at 00:00 UTC daily.");
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  log.info(`[DailyRollingWindow] Received ${signal}, shutting down…`);
  await closeRedis();
  process.exit(0);
}

process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

startDaemon().catch((err) => {
  log.error(`[DailyRollingWindow] Fatal startup error: ${err}`);
  process.exit(1);
});
