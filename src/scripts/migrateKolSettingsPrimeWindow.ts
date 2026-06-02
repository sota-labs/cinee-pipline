/** One-time migration — backfill prime_window and tier_batch_intervals on existing KolSettings documents */
import { connectDb, disconnectDb } from "../db/connection.js";
import { KolSettings } from "../db/models/KolSettings.js";
import { log } from "../utils/logger.js";

async function main(): Promise<"ok" | "error"> {
  try {
    await connectDb();
    log.info("[MigrateKolSettingsPrimeWindow] Connected to DB.");

    // Use .lean() to read the raw BSON document — Mongoose would otherwise
    // hydrate missing subdocs with schema defaults and hide the fact that
    // prime_window / tier_batch_intervals were never persisted.
    const settings = await KolSettings.findOne().lean();

    if (!settings) {
      log.info("[MigrateKolSettingsPrimeWindow] No KolSettings document found — nothing to migrate.");
      await disconnectDb();
      return "ok";
    }

    const pw = settings.prime_window;
    const tbi = settings.tier_batch_intervals;
    const pwSet =
      pw &&
      typeof pw.start_hour === "number" && pw.start_hour >= 0 &&
      typeof pw.end_hour === "number" && pw.end_hour >= 1;
    const tbiSet =
      tbi &&
      typeof tbi.A === "number" && tbi.A > 0 &&
      typeof tbi.B === "number" && tbi.B > 0 &&
      typeof tbi.C === "number" && tbi.C > 0;

    if (pwSet && tbiSet) {
      log.info(
        `[MigrateKolSettingsPrimeWindow] Already set — prime_window: ${pw.start_hour}-${pw.end_hour}, ` +
        `tier_batch_intervals: A:${tbi.A} B:${tbi.B} C:${tbi.C}. No changes made.`,
      );
      await disconnectDb();
      return "ok";
    }

    await KolSettings.updateOne(
      { _id: settings._id },
      {
        $set: {
          "prime_window.start_hour": 9,
          "prime_window.end_hour": 13,
          "tier_batch_intervals.A": 120,
          "tier_batch_intervals.B": 180,
          "tier_batch_intervals.C": 240,
        },
      },
    );

    log.info(
      "[MigrateKolSettingsPrimeWindow] Migration complete — " +
      "prime_window: 9-13 (UTC), tier_batch_intervals: A:120 B:180 C:240 (minutes).",
    );

    await disconnectDb();
    return "ok";
  } catch (error) {
    log.error(`[MigrateKolSettingsPrimeWindow] Fatal error: ${(error as Error).message}`);
    await disconnectDb().catch(() => {});
    return "error";
  }
}

const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith("migrateKolSettingsPrimeWindow.ts") ||
    process.argv[1].endsWith("migrateKolSettingsPrimeWindow.js"));

if (isMainModule) {
  main().then((status) => {
    process.exit(status === "ok" ? 0 : 1);
  });
}

export { main as runMigrateKolSettingsPrimeWindow };
