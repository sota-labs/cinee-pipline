/** Express application setup. */
import express from "express";
import cors from "cors";
import { schedulerRouter } from "./routes/scheduler.js";
import { statusRouter } from "./routes/status.js";
import { toolsRouter } from "./routes/tools.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use("/api/scheduler", schedulerRouter);
app.use("/api", statusRouter);
app.use("/api/tools", toolsRouter);

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
    },
  });
});

export { app };
