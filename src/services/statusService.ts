/** Status service — health and stats reporting. */
import { settings } from "../config/settings.js";
import { Post, Reply } from "../db/index.js";

async function getQuickStats(): Promise<Record<string, number>> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [posts_today, replies_draft] = await Promise.all([
    Post.countDocuments({ created_at: { $gte: today } }),
    Reply.countDocuments({ status: "draft" }),
  ]);
  return { posts_today, replies_draft };
}

export async function getSystemStatus(): Promise<Record<string, unknown>> {
  const [stats] = await Promise.all([
    getQuickStats(),
  ]);

  return {
    status: "healthy",
    node: {
      status: "running",
      port: settings.port,
      env: process.env.NODE_ENV || "development",
    },
    pipeline: { daily_stats: stats },
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
