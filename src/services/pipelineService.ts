/** Pipeline service — orchestrates all pipeline operations via Python CrewAI. */
import { callPythonService } from "../utils/pythonBridge.js";
import { log } from "../utils/logger.js";
import * as memoryTools from "../tools/memoryTools.js";
import { Post, Interaction, Reply, CurationSource } from "../db/index.js";

async function getDailyStats(): Promise<Record<string, number>> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [posts, posted, pending_interactions, replies, curation_unused] = await Promise.all([
    Post.countDocuments({ created_at: { $gte: today } }),
    Post.countDocuments({ status: "posted", created_at: { $gte: today } }),
    Interaction.countDocuments({ processed: false }),
    Reply.countDocuments({ created_at: { $gte: today } }),
    CurationSource.countDocuments({ used: false }),
  ]);
  return { posts_today: posts, posts_posted: posted, pending_interactions, replies_today: replies, curation_unused };
}

export class PipelineService {
  async runDailyStrategy(): Promise<Record<string, unknown>> {
    log.info("=== DAILY STRATEGY ===");
    const result = await callPythonService("/run-strategy");
    if (result.success !== false) {
      await memoryTools.storeContentHistory("strategy", JSON.stringify(result), null, { type: "daily_strategy" });
      await memoryTools.storeMemory("state:current_strategy", JSON.stringify(result));
      log.info("Strategy stored");
    }
    return result;
  }

  async runAmplification(count = 3): Promise<Record<string, unknown>> {
    log.info("=== AI FILM AMPLIFICATION (browser) ===");
    const result = await callPythonService("/run-amplification", { count });
    if (result.success !== false) {
      await memoryTools.storeContentHistory("amplification", JSON.stringify(result), null, { task: "ai_film_amplification" });
      log.info("Amplification complete");
    }
    return result;
  }

  async runHotTake(): Promise<Record<string, unknown>> {
    log.info("=== CEO HOT TAKE (browser) ===");
    const result = await callPythonService("/run-hot-take");
    if (result.success !== false) {
      await memoryTools.storeContentHistory("hot_take", JSON.stringify(result), null, { task: "ceo_hot_take" });
      log.info("Hot take posted");
    }
    return result;
  }

  async runEngagement(count = 10): Promise<Record<string, unknown>> {
    log.info("=== TWITTER ENGAGEMENT (browser) ===");
    const result = await callPythonService("/run-engagement", { count });
    if (result.success !== false) {
      await memoryTools.storeEngagementPattern("daily_engagement", { task: "twitter_engagement" });
      log.info("Engagement round complete");
    }
    return result;
  }

  async runMentions(): Promise<Record<string, unknown>> {
    log.info("=== MENTION CHECK (browser) ===");
    const result = await callPythonService("/run-mentions");
    if (result.success !== false) log.info("Mentions processed");
    return result;
  }

  async runReddit(count = 3): Promise<Record<string, unknown>> {
    log.info("=== REDDIT DISCUSSION (browser) ===");
    const result = await callPythonService("/run-reddit", { count });
    if (result.success !== false) {
      await memoryTools.storeContentHistory("reddit_engagement", JSON.stringify(result), null, { task: "reddit_discussion" });
      log.info("Reddit engagement complete");
    }
    return result;
  }

  async runFullDailyCycle(): Promise<Record<string, unknown>> {
    log.info("=== FULL DAILY CYCLE ===");
    const results: Record<string, unknown> = {};
    try {
      results.strategy = await this.runDailyStrategy();
      results.amplification = await this.runAmplification();
      results.hotTake = await this.runHotTake();
      results.engagement = await this.runEngagement();
      results.mentions = await this.runMentions();
      results.reddit = await this.runReddit();
      results.stats = await getDailyStats();
    } catch (error: any) {
      log.error(`Pipeline cycle error: ${error.message}`);
      results.error = error.message;
    }
    log.info("=== DAILY CYCLE COMPLETE ===");
    return results;
  }

  async getStatus(): Promise<Record<string, unknown>> {
    return { stats: await getDailyStats(), timestamp: new Date().toISOString() };
  }
}

export const pipelineService = new PipelineService();
