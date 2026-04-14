/** Express application setup. */
import express from "express";
import cors, { CorsOptions } from "cors";
import { schedulerRouter } from "./routes/scheduler.js";
import { statusRouter } from "./routes/status.js";
import { toolsRouter } from "./routes/tools.js";
import { contentReviewRouter } from "./routes/contentReview.js";
import { priorityAccountsRouter } from "./routes/priorityAccounts.js";
import { topicConfigRouter } from "./routes/topicConfig.js";
import { tasksRouter } from "./routes/tasks.js";

// Comma-separated list of allowed origins, e.g. "https://your-frontend.com,https://admin.your-frontend.com"
const allowedOrigins: string[] = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Allow server-to-server requests (no Origin header) only when no origins are configured
    if (!origin) {
      return callback(null, allowedOrigins.length === 0);
    }
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin "${origin}" is not allowed`));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
  credentials: true,
};

const app = express();

app.use(cors(corsOptions));
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
