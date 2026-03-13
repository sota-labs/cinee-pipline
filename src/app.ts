/** Express application setup. */
import express from "express";
import cors from "cors";
import { pipelineRouter } from "./routes/pipeline.js";
import { schedulerRouter } from "./routes/scheduler.js";
import { statusRouter } from "./routes/status.js";
import { toolsRouter } from "./routes/tools.js";

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Routes
app.use("/api/pipeline", pipelineRouter);
app.use("/api/scheduler", schedulerRouter);
app.use("/api", statusRouter);
app.use("/api/tools", toolsRouter);

// Root
app.get("/", (_req, res) => {
  res.json({
    name: "pipline-js",
    description: "Social Media Automation Pipeline",
    version: "1.0.0",
    endpoints: {
      pipeline: "/api/pipeline/*",
      scheduler: "/api/scheduler/*",
      health: "/api/health",
      status: "/api/status",
      tools: "/api/tools/*",
    },
  });
});

export { app };
