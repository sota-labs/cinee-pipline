/** ReplyEvalService — log every reply generation + admin decision for KPI measurement */
import { createHash } from "node:crypto";
import { log } from "../utils/logger.js";
import { settings } from "../config/settings.js";
import {
  ReplyEvalLog,
  EEvalLogSource,
  type IReplyEvalLog,
} from "../db/models/ReplyEvalLog.js";

export { EEvalLogSource };

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

function findBlacklistHits(text: string, blacklist: string[]): string[] {
  if (!blacklist || blacklist.length === 0) return [];
  const lower = text.toLowerCase();
  return blacklist.filter((word) => lower.includes(word.toLowerCase()));
}

export function computeEditRatio(original: string, edited: string): number {
  if (!original) return edited ? 1 : 0;
  const a = new Set(original.toLowerCase().split(/\s+/).filter(Boolean));
  const b = new Set(edited.toLowerCase().split(/\s+/).filter(Boolean));
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  return 1 - intersection.size / union.size;
}

export interface ILogReplyInput {
  source: EEvalLogSource;
  suggestion_id?: string;
  self_reply_queue_id?: string;
  parent_post_id?: string;
  prompt: string;
  outputText: string;
  toneUsed: string;
  model?: string;
}

export async function logReply(
  input: ILogReplyInput,
): Promise<IReplyEvalLog | null> {
  try {
    const blacklist = settings.role.blacklistedWords ?? [];
    return await ReplyEvalLog.create({
      source: input.source,
      suggestion_id: input.suggestion_id,
      self_reply_queue_id: input.self_reply_queue_id,
      parent_post_id: input.parent_post_id,
      prompt_hash: hashPrompt(input.prompt),
      llmModel: input.model ?? settings.openClawReplyModel,
      prompt_length_chars: input.prompt.length,
      prompt_length_tokens_est: Math.ceil(input.prompt.length / 4),
      tone_used: input.toneUsed,
      output_text: input.outputText,
      output_length_chars: input.outputText.length,
      blacklisted_words_found: findBlacklistHits(input.outputText, blacklist),
    });
  } catch (err: unknown) {
    log.error(`[ReplyEval] Failed to log reply: ${(err as Error).message}`);
    return null;
  }
}

export interface IRecordDecisionInput {
  reply_eval_log_id?: string;
  suggestion_id?: string;
  self_reply_queue_id?: string;
  output_text: string;
  decision: "approved" | "edited" | "rejected" | "auto_afk" | "auto_manual";
  edited_text?: string;
}

export async function recordDecision(
  input: IRecordDecisionInput,
): Promise<void> {
  let filter: Record<string, unknown>;
  if (input.reply_eval_log_id) {
    filter = { _id: input.reply_eval_log_id };
  } else if (input.suggestion_id) {
    filter = { suggestion_id: input.suggestion_id };
  } else if (input.self_reply_queue_id) {
    filter = { self_reply_queue_id: input.self_reply_queue_id };
  } else {
    log.error("[ReplyEval] recordDecision called without identifying filter");
    return;
  }

  const update: Record<string, unknown> = {
    admin_decision: input.decision,
    decided_at: new Date(),
  };
  if (input.edited_text) {
    update.admin_edited_text = input.edited_text;
    update.edit_ratio = computeEditRatio(input.output_text, input.edited_text);
  } else if (
    input.decision === "approved" ||
    input.decision === "auto_afk" ||
    input.decision === "auto_manual"
  ) {
    update.edit_ratio = 0;
  } else if (input.decision === "rejected") {
    update.edit_ratio = 1;
  }

  await ReplyEvalLog.updateOne(filter, { $set: update });
}
