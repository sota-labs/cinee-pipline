/** TopicConfig service — CRUD and activation logic for runtime topic configs. */
import { TopicConfig, ITopicConfig } from "../db/models/TopicConfig.js";
import { RoleConfig, settings } from "../config/settings.js";
import { log } from "../utils/logger.js";

/** Map ITopicConfig fields → RoleConfig so promptBuilder can consume it. */
function toRoleConfig(doc: ITopicConfig): RoleConfig {
  return {
    name: doc.name,
    brand: doc.brand,
    founderName: settings.role.founderName,
    website: settings.role.website,
    companyStage: settings.role.companyStage,
    persona: doc.persona,
    tone: doc.tone,
    topics: doc.topics,
    communities: doc.communities,
    engagementKeywords: doc.engagement_keywords,
    searchKeywords: doc.search_keywords.length > 0 ? doc.search_keywords : doc.engagement_keywords,
    slangExamples: doc.slang_examples,
    blacklistedWords: doc.blacklisted_words,
    brandMentionBan: doc.brand_mention_ban,
    humanStyleLevel: doc.human_style_level,
  };
}

/**
 * Returns the currently active RoleConfig from the DB.
 * Falls back to the in-process settings.role if nothing is active in DB.
 */
export async function getActiveRoleConfig(): Promise<RoleConfig> {
  try {
    const active = await TopicConfig.findOne({ is_active: true }).lean();
    if (active) {
      return toRoleConfig(active as ITopicConfig);
    }
  } catch (err) {
    log.error(`[topicConfigService] DB query failed: ${(err as Error).message}`);
  }
  return settings.role;
}

/** List all topic configs (name, is_active, description). */
export async function listTopicConfigs(): Promise<ITopicConfig[]> {
  return TopicConfig.find().sort({ is_active: -1, name: 1 }).lean() as Promise<ITopicConfig[]>;
}

/** Get a single topic config by ID. */
export async function getTopicConfigById(id: string): Promise<ITopicConfig | null> {
  return TopicConfig.findById(id).lean() as Promise<ITopicConfig | null>;
}

/** Create a new topic config. */
export async function createTopicConfig(
  data: Partial<ITopicConfig>,
): Promise<ITopicConfig> {
  const doc = new TopicConfig(data);
  return doc.save();
}

/** Update a topic config by ID (partial update). */
export async function updateTopicConfig(
  id: string,
  data: Partial<ITopicConfig>,
): Promise<ITopicConfig | null> {
  return TopicConfig.findByIdAndUpdate(id, { $set: data }, { new: true }).lean() as Promise<ITopicConfig | null>;
}

/** Delete a topic config by ID. */
export async function deleteTopicConfig(id: string): Promise<boolean> {
  const result = await TopicConfig.findByIdAndDelete(id);
  return result !== null;
}

/**
 * Set a topic config as active (deactivates all others atomically).
 * Returns the newly activated config, or null if not found.
 */
export async function activateTopicConfig(id: string): Promise<ITopicConfig | null> {
  await TopicConfig.updateMany({ is_active: true }, { $set: { is_active: false } });
  return TopicConfig.findByIdAndUpdate(
    id,
    { $set: { is_active: true } },
    { new: true },
  ).lean() as Promise<ITopicConfig | null>;
}

/** Deactivate all topic configs (revert to settings.ts default). */
export async function deactivateAll(): Promise<void> {
  await TopicConfig.updateMany({}, { $set: { is_active: false } });
}
