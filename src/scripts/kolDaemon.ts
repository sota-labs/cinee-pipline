/**
 * Standalone daemon — KOL unified workflow job.
 *
 * Runs scheduled tasks for KOL crawling, analyzing, AFK replies, and self-replies.
 * Can also be triggered immediately with the --run-now flag.
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

import { crawlDueKols } from "../services/kolCrawlerService.js";
import { kolAnalyzerService } from "../services/kolAnalyzerService.js";
import { replyEngineService } from "../services/replyEngineService.js";
import { selfReplyService } from "../services/selfReplyService.js";

const RUN_NOW = process.argv.includes("--run-now");

let isTierCrawling = false;

async function executeTierCrawl() {
  if (isTierCrawling) {
    log.warn("[KOLDaemon] Tier crawl already in progress, skipping tick");
    return;
  }
  isTierCrawling = true;
  log.info("[KOLDaemon] Tier crawl job starting…");
  try {
    const result = await crawlDueKols();
    log.info(`[KOLDaemon] Tier crawl done — spawned ${result.tasksCreated} tasks for: ${result.handles.join(", ")}`);
  } catch (err: unknown) {
    log.error(`[KOLDaemon] Tier crawl job crashed: ${(err as Error).message}`);
  } finally {
    isTierCrawling = false;
  }
}

async function executeAnalyze() {
  log.info("[KOLDaemon] Analyze job starting…");
  try {
    const result = await kolAnalyzerService.analyzePendingPosts();
    log.info(`[KOLDaemon] Analyze done — queued: ${result.queued}, errors: ${result.errors}`);
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
      agent: "",
      prompt: "",
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

async function startDaemon() {
  await connectDb();
  log.info("[KOLDaemon] Connected to MongoDB.");

  if (RUN_NOW) {
    // Run sequentially to avoid DB overload on startup
    await executeTierCrawl();
    await executeAnalyze();
    await executeAFKReplies();
    await executeSelfReplies();
  }

  // Schedule jobs
  
  // Tier-based crawl every hour — only crawls KOLs whose per-tier interval has elapsed
  cron.schedule("0 * * * *", executeTierCrawl);
  
  // Analyze pending posts every 10 minutes
  cron.schedule("*/10 * * * *", executeAnalyze);
  
  // Execute scheduled AFK replies every 10 minutes
  cron.schedule("*/10 * * * *", executeAFKReplies);

  // Auto-reject expired manual suggestions every 10 minutes
  cron.schedule("*/10 * * * *", executeAutoReject);
  
  // Process self-reply queues every 2 minutes to allow 1-3 min dynamic delay
  cron.schedule("*/2 * * * *", executeSelfReplies);

  // Clean up openclaw session files older than 3 days, every 2 hours
  cron.schedule("0 */2 * * *", executeSessionCleanup);

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
