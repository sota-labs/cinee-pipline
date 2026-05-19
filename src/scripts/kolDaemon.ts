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

import { crawlAllKolsSequential } from "../services/kolCrawlerService.js";
import { kolAnalyzerService } from "../services/kolAnalyzerService.js";
import { replyEngineService } from "../services/replyEngineService.js";
import { selfReplyService } from "../services/selfReplyService.js";

const RUN_NOW = process.argv.includes("--run-now");

async function executeCrawl() {
  log.info("[KOLDaemon] Crawl job starting…");
  try {
    const result = await crawlAllKolsSequential();
    log.info(`[KOLDaemon] Crawl done — spawned ${result.tasksCreated} tasks for: ${result.handles.join(", ")}`);
  } catch (err: unknown) {
    log.error(`[KOLDaemon] Crawl job crashed: ${(err as Error).message}`);
  }
}

async function executeAnalyze() {
  log.info("[KOLDaemon] Analyze job starting…");
  try {
    const result = await kolAnalyzerService.analyzePendingPosts();
    log.info(`[KOLDaemon] Analyze done — queued: ${result.queued}, errors: ${result.errors}`);
  } catch (err: any) {
    log.error(`[KOLDaemon] Analyze job crashed: ${err.message}`);
  }
}

async function executeAFKReplies() {
  log.info("[KOLDaemon] AFK Reply job starting…");
  try {
    const result = await replyEngineService.runScheduledAFKReplies();
    log.info(`[KOLDaemon] AFK Reply done — processed: ${result.processed}, succeeded: ${result.succeeded}, failed: ${result.failed}`);
  } catch (err: any) {
    log.error(`[KOLDaemon] AFK Reply job crashed: ${err.message}`);
  }
}

async function executeSelfReplies() {
  log.info("[KOLDaemon] Self-Reply job starting…");
  try {
    const result = await selfReplyService.processAllQueues();
    log.info(`[KOLDaemon] Self-Reply done — processed: ${result.processed}, succeeded: ${result.succeeded}, failed: ${result.failed}`);
  } catch (err: any) {
    log.error(`[KOLDaemon] Self-Reply job crashed: ${err.message}`);
  }
}

async function executeAutoReject() {
  log.info("[KOLDaemon] Auto-Reject job starting…");
  try {
    const result = await replyEngineService.runAutoRejectExpired();
    if (result.rejected > 0) {
      log.info(`[KOLDaemon] Auto-Reject done — rejected: ${result.rejected}`);
    }
  } catch (err: any) {
    log.error(`[KOLDaemon] Auto-Reject job crashed: ${err.message}`);
  }
}

async function executeDailyLearning() {
  log.info("[KOLDaemon] Daily Personality Learning job starting…");
  try {
    const result = await kolAnalyzerService.runDailyPersonalityLearning();
    log.info(`[KOLDaemon] Daily Learning done — processed: ${result.processed}, failed: ${result.failed}`);
  } catch (err: any) {
    log.error(`[KOLDaemon] Daily Learning job crashed: ${err.message}`);
  }
}

async function startDaemon() {
  await connectDb();
  log.info("[KOLDaemon] Connected to MongoDB.");

  if (RUN_NOW) {
    // Run sequentially to avoid DB overload on startup
    await executeCrawl();
    await executeAnalyze();
    await executeAFKReplies();
    await executeSelfReplies();
  }

  // Schedule jobs
  
  // Crawl new posts every 4 hours — spawns parallel tasks (2 handles/task, covers all KOLs in 24h)
  cron.schedule("0 */4 * * *", executeCrawl);
  
  // Analyze pending posts every 10 minutes
  cron.schedule("*/10 * * * *", executeAnalyze);
  
  // Execute scheduled AFK replies every 10 minutes
  cron.schedule("*/10 * * * *", executeAFKReplies);

  // Auto-reject expired manual suggestions every 10 minutes
  cron.schedule("*/10 * * * *", executeAutoReject);
  
  // Process self-reply queues every 2 minutes to allow 1-3 min dynamic delay
  cron.schedule("*/2 * * * *", executeSelfReplies);

  // Run daily personality learning at 02:00 AM
  cron.schedule("0 2 * * *", executeDailyLearning, { timezone: "UTC" });

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
