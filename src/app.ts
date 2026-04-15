/** Express application setup. */
import express from "express";
import cors from "cors";
import { schedulerRouter } from "./routes/scheduler.js";
import { statusRouter } from "./routes/status.js";
import { toolsRouter } from "./routes/tools.js";
import { contentReviewRouter } from "./routes/contentReview.js";
import { priorityAccountsRouter } from "./routes/priorityAccounts.js";
import { topicConfigRouter } from "./routes/topicConfig.js";
import { tasksRouter } from "./routes/tasks.js";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));

app.use("/api/scheduler", schedulerRouter);
app.use("/api", statusRouter);
app.use("/api/tools", toolsRouter);
app.use("/api/content-review", contentReviewRouter);
app.use("/api/priority-accounts", priorityAccountsRouter);
app.use("/api/topic-config", topicConfigRouter);
app.use("/api/tasks", tasksRouter);

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
      priority_accounts: "/api/priority-accounts/*",
      topic_config: "/api/topic-config/*",
      tasks: "/api/tasks/*",
    },
  });
});

export { app };
