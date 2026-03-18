/** Status service — pipeline health and status reporting. */
import { checkPythonServiceHealth } from "../utils/pythonBridge.js";
import { rateLimiter } from "../tools/rateLimiter.js";
import { settings } from "../config/settings.js";
import { Post, Interaction, CurationSource } from "../db/index.js";

async function getQuickStats(): Promise<Record<string, number>> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [posts_today, pending_interactions, curation_unused] = await Promise.all([
    Post.countDocuments({ created_at: { $gte: today } }),
    Interaction.countDocuments({ processed: false }),
    CurationSource.countDocuments({ used: false }),
  ]);
  return { posts_today, pending_interactions, curation_unused };
}

export async function getSystemStatus(): Promise<Record<string, unknown>> {
  const [pythonHealthy, stats, rateLimits] = await Promise.all([
    checkPythonServiceHealth(),
    getQuickStats(),
    rateLimiter.getRateLimitStatus(),
  ]);

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
    pipeline: { daily_stats: stats },
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
