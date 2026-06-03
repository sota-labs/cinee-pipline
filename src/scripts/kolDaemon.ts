/**
 * Standalone daemon — KOL unified workflow job.
 *
 * Runs scheduled tasks for KOL crawling, analyzing, AFK replies, and self-replies.
 * The cron-scheduled logic lives in kolScheduleService (testable); this script
 * is a thin wrapper that wires the schedules to node-cron and the process
 * lifecycle.
 *
 * Usage:
 *   npm run kol:daemon          # start daemon
 *   npm run kol:daemon -- --run-now  # also fire once on startup
 */
import cron from "node-cron";
import { connectDb } from "../db/connection.js";
import { closeRedis } from "../db/redis.js";
import { log } from "../utils/logger.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";
import { kolAnalyzerService } from "../services/kolAnalyzerService.js";
import { replyEngineService } from "../services/replyEngineService.js";
import { selfReplyService } from "../services/selfReplyService.js";
import { ownAccountService } from "../services/ownAccountService.js";
import { runPrimePolling, runBatchCrawl } from "../services/kolScheduleService.js";

const RUN_NOW = process.argv.includes("--run-now");

// ── Analyze / Reply / Cleanup (unchanged) ────────────────────────────────────

async function executeAnalyze() {
  log.info("[KOLDaemon] Analyze job starting…");
  try {
    const result = await kolAnalyzerService.analyzePendingPosts();
    const sweepNote = result.swept > 0 ? ` (swept ${result.swept} stuck)` : "";
    log.info(`[KOLDaemon] Analyze done — queued: ${result.queued}, errors: ${result.errors}${sweepNote}`);
  } catch (err: unknown) {
    log.error(`[KOLDaemon] Analyze job crashed: ${(err as Error).message}`);
  }
}

async function executeAFKReplies() {
  log.info("[KOLDaemon] AFK Reply job starting…");
  try {
    const result = await replyEngineService.runScheduledAFKReplies();
    log.info(`[KOLDaemon] AFK Reply done — processed: ${result.processed}, succeeded: ${result.succeeded}, failed: ${result.failed}`);
  } catch (err: unknown) {
    log.error(`[KOLDaemon] AFK Reply job crashed: ${(err as Error).message}`);
  }
}

async function executeSelfReplies() {
  log.info("[KOLDaemon] Self-Reply job starting…");
  try {
    const result = await selfReplyService.processAllQueues();
    log.info(`[KOLDaemon] Self-Reply done — processed: ${result.processed}, succeeded: ${result.succeeded}, failed: ${result.failed}`);
  } catch (err: unknown) {
    log.error(`[KOLDaemon] Self-Reply job crashed: ${(err as Error).message}`);
  }
}

async function executeAutoLearnPersonality() {
  log.info("[KOLDaemon] Auto-learn personality tick…");
  try {
    const taskId = await ownAccountService.autoLearnPersonality();
    if (taskId) {
      log.info(`[KOLDaemon] Auto-learn queued task: ${taskId}`);
    }
  } catch (err: unknown) {
    log.error(`[KOLDaemon] Auto-learn crashed: ${(err as Error).message}`);
  }
}

async function executeAutoReject() {
  log.info("[KOLDaemon] Auto-Reject job starting…");
  try {
    const result = await replyEngineService.runAutoRejectExpired();
    if (result.rejected > 0) {
      log.info(`[KOLDaemon] Auto-Reject done — rejected: ${result.rejected}`);
    }
  } catch (err: unknown) {
    log.error(`[KOLDaemon] Auto-Reject job crashed: ${(err as Error).message}`);
  }
}

async function executeSessionCleanup() {
  try {
    const sessionDir = `${process.env.HOME}/.openclaw/agents/main/sessions`;
    await Task.create({
      type: ETaskType.SHELL_EXEC,
      agent: "system",
      prompt: "session_cleanup",
      status: ETaskStatus.PENDING,
      priority: 0,
      payload: {
        action: "session_cleanup",
        sessionDir,
        olderThanMinutes: 120,
      },
    });
    log.info("[KOLDaemon] Session cleanup task queued");
  } catch (err: unknown) {
    log.warn(`[KOLDaemon] Failed to queue session cleanup task: ${(err as Error).message}`);
  }
}

// ── Schedule wrappers ───────────────────────────────────────────────────────

async function tickPrimePolling() {
  try {
    const r = await runPrimePolling();
    if (!r.skipped && !r.outsideWindow) {
      log.info(`[KOLDaemon] Prime poll — polled ${r.polled} KOLs`);
    }
  } catch (err: unknown) {
    log.error(`[KOLDaemon] Prime poll crashed: ${(err as Error).message}`);
  }
}

async function tickBatchCrawl(tiers: Array<"S" | "A" | "B" | "C">) {
  try {
    const r = await runBatchCrawl(tiers);
    if (!r.busy) {
      log.info(`[KOLDaemon] Batch [${tiers.join(",")}] — created ${r.created} tasks, skipped ${r.skipped}`);
    }
  } catch (err: unknown) {
    log.error(`[KOLDaemon] Batch [${tiers.join(",")}] crashed: ${(err as Error).message}`);
  }
}

async function startDaemon() {
  await connectDb();
  log.info("[KOLDaemon] Connected to MongoDB.");

  if (RUN_NOW) {
    await tickPrimePolling();
    await executeAnalyze();
    await executeAFKReplies();
    await executeSelfReplies();
    await executeAutoLearnPersonality();
  }

  // Schedule jobs
  cron.schedule("*/15 * * * *", tickPrimePolling);
  cron.schedule("0 */2 * * *", () => tickBatchCrawl(["S", "A"]));
  cron.schedule("0 */3 * * *", () => tickBatchCrawl(["B"]));
  cron.schedule("0 */4 * * *", () => tickBatchCrawl(["C"]));
  cron.schedule("*/1 * * * *", executeAnalyze);
  cron.schedule("*/10 * * * *", executeAFKReplies);
  cron.schedule("*/10 * * * *", executeAutoReject);
  cron.schedule("*/2 * * * *", executeSelfReplies);
  cron.schedule("0 */2 * * *", executeSessionCleanup);
  cron.schedule("0 */6 * * *", executeAutoLearnPersonality);

  log.info("[KOLDaemon] Daemon ready — schedules applied.");
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal: string) {
  log.info(`[KOLDaemon] Received ${signal}, shutting down…`);
  await closeRedis();
  process.exit(0);
}

process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

startDaemon().catch((err) => {
  log.error(`[KOLDaemon] Fatal startup error: ${err}`);
  process.exit(1);
});
