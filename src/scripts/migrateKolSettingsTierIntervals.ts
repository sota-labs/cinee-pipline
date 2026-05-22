/** One-time migration — backfill tier_crawl_intervals on existing KolSettings documents */
import { connectDb, disconnectDb } from "../db/connection.js";
import { KolSettings } from "../db/models/KolSettings.js";
import { log } from "../utils/logger.js";

async function main(): Promise<void> {
  try {
    await connectDb();
    log.info("[MigrateKolSettings] Connected to DB.");

    const settings = await KolSettings.findOne();

    if (!settings) {
      log.info("[MigrateKolSettings] No KolSettings document found — nothing to migrate.");
      await disconnectDb();
      process.exit(0);
    }

    const tci = settings.tier_crawl_intervals;
    const alreadySet =
      tci &&
      typeof tci.S === "number" && tci.S > 0 &&
      typeof tci.A === "number" && tci.A > 0 &&
      typeof tci.B === "number" && tci.B > 0 &&
      typeof tci.C === "number" && tci.C > 0;

    if (alreadySet) {
      log.info(
        `[MigrateKolSettings] tier_crawl_intervals already set — S:${tci.S} A:${tci.A} B:${tci.B} C:${tci.C}. No changes made.`,
      );
      await disconnectDb();
      process.exit(0);
    }

    // Apply defaults matching the schema
    await KolSettings.updateOne(
      { _id: settings._id },
      {
        $set: {
          "tier_crawl_intervals.S": 30,
          "tier_crawl_intervals.A": 120,
          "tier_crawl_intervals.B": 240,
          "tier_crawl_intervals.C": 480,
        },
      },
    );

    log.info("[MigrateKolSettings] Migration complete — tier_crawl_intervals set to S:30 A:120 B:240 C:480 (minutes).");

    await disconnectDb();
    process.exit(0);
  } catch (error) {
    log.error(`[MigrateKolSettings] Fatal error: ${(error as Error).message}`);
    await disconnectDb().catch(() => {});
    process.exit(1);
  }
}

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("migrateKolSettingsTierIntervals.ts") ||
    process.argv[1].endsWith("migrateKolSettingsTierIntervals.js"));

if (isMainModule) {
  main();
}

export { main as runMigrateKolSettingsTierIntervals };
