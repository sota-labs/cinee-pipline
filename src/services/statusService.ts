/** Status service — pipeline health and status reporting. */
import { checkPythonServiceHealth } from "../utils/pythonBridge.js";
import { getDailyStats } from "../tools/db.js";
import { rateLimiter } from "../tools/rateLimiter.js";
import { settings } from "../config/settings.js";

export async function getSystemStatus(): Promise<Record<string, unknown>> {
  const pythonHealthy = await checkPythonServiceHealth();
  const stats = getDailyStats();
  const rateLimits = await rateLimiter.getRateLimitStatus();

  return {
    status: pythonHealthy ? "healthy" : "degraded",
    node: {
      status: "running",
      port: settings.port,
      env: process.env.NODE_ENV || "development",
    },
    python_service: {
      status: pythonHealthy ? "connected" : "disconnected",
      url: settings.pythonServiceUrl,
    },
    pipeline: {
      daily_stats: stats,
    },
    rate_limits: rateLimits,
    timestamp: new Date().toISOString(),
  };
}

export function getHealthCheck(): Record<string, unknown> {
  return {
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };
}
