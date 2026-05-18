/** seedOwnAccountPosts — Crawl and seed own account posts into DB for AI learning.
 *
 * Usage:
 *   npx tsx src/scripts/seedOwnAccountPostsCron.ts
 *   npx tsx src/scripts/seedOwnAccountPostsCron.ts --days 60 --limit 200
 *
 * Options:
 *   --days  <n>   How many days back to crawl (default: 30)
 *   --limit <n>   Max posts to seed (default: 100)
 */
import { ownAccountCrawlerService } from "../services/ownAccountCrawlerService.js";
import { connectDb, disconnectDb } from "../db/connection.js";
import { log } from "../utils/logger.js";

function parseArgs(): { daysBack: number; limit: number } {
  const args = process.argv.slice(2);
  let daysBack = 30;
  let limit = 100;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--days" && args[i + 1]) {
      daysBack = parseInt(args[i + 1], 10) || 30;
    }
    if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1], 10) || 100;
    }
  }

  return { daysBack, limit };
}

async function main(): Promise<void> {
  try {
    await connectDb();

    const { daysBack, limit } = parseArgs();
    const existing = await ownAccountCrawlerService.countSeedPosts();

    log.info(
      `[SeedOwnAccountPosts] DB has ${existing} own-account posts. ` +
        `Queuing crawl: last ${daysBack} days, max ${limit} posts.`,
    );

    const taskId = await ownAccountCrawlerService.queueCrawlTask({ daysBack, limit });

    if (taskId) {
      log.info(`[SeedOwnAccountPosts] Crawl task queued: ${taskId}`);
      log.info(
        "[SeedOwnAccountPosts] cinee-worker will execute the crawl and call back with results.",
      );
      log.info(
        "[SeedOwnAccountPosts] After task completes, call ownAccountCrawlerService.processCrawlResult() with the result.",
      );
    } else {
      log.error("[SeedOwnAccountPosts] Failed to queue crawl task — check X_USERNAME env var.");
    }

    await disconnectDb();
    process.exit(0);
  } catch (error) {
    log.error(`[SeedOwnAccountPosts] Fatal error: ${(error as Error).message}`);
    await disconnectDb().catch(() => {});
    process.exit(1);
  }
}

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("seedOwnAccountPostsCron.ts") ||
    process.argv[1].endsWith("seedOwnAccountPostsCron.js"));

if (isMainModule) {
  main();
}

export { main as runSeedOwnAccountPosts };
