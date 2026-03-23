/** Express application setup. */
import express from "express";
import cors from "cors";
import { schedulerRouter } from "./routes/scheduler.js";
import { statusRouter } from "./routes/status.js";
import { toolsRouter } from "./routes/tools.js";
import { contentReviewRouter } from "./routes/contentReview.js";
import { telegramRouter } from "./routes/telegram.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use("/api/scheduler", schedulerRouter);
app.use("/api", statusRouter);
app.use("/api/tools", toolsRouter);
app.use("/api/content-review", contentReviewRouter);
app.use("/api/telegram", telegramRouter);

app.get("/", (_req, res) => {
  res.json({
    name: "cinee-pipeline",
    description: "CEO Automation Pipeline — OpenClaw + MongoDB",
    version: "2.0.0",
    endpoints: {
      scheduler: "/api/scheduler/*",
      health: "/api/health",
      status: "/api/status",
      tools: "/api/tools/*",
      content_review: "/api/content-review/*",
      telegram: "/api/telegram/*",
    },
  });
});

export { app };
