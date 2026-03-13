/** Entry point — starts the Express server. */
import { app } from "./app.js";
import { settings } from "./config/settings.js";
import { log } from "./utils/logger.js";

const port = settings.port;

app.listen(port, () => {
  log.info(`🚀 pipline-js server running on http://localhost:${port}`);
  log.info(`   Python service expected at ${settings.pythonServiceUrl}`);
  log.info(`   Environment: ${process.env.NODE_ENV || "development"}`);
});
