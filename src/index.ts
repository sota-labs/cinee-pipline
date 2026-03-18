/** Entry point — connects to MongoDB then starts the Express server. */
import { app } from "./app.js";
import { settings } from "./config/settings.js";
import { connectDb } from "./db/index.js";
import { log } from "./utils/logger.js";

async function start() {
  await connectDb();

  app.listen(settings.port, () => {
    log.info(`Server running on http://localhost:${settings.port}`);
    log.info(`Python service expected at ${settings.pythonServiceUrl}`);
    log.info(`Environment: ${process.env.NODE_ENV || "development"}`);
  });
}

start().catch((err) => {
  console.error("Startup error:", err);
  process.exit(1);
});
