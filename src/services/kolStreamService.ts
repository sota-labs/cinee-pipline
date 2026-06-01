/** KolStreamService — Manages X Filtered Stream for Tier S/A KOL post detection */
import { log } from "../utils/logger.js";
import type { IKolProfile } from "../db/models/KolProfile.js";
import {
  getStreamRules,
  addStreamRules,
  deleteStreamRules,
  connectFilteredStream,
  type IStreamRuleAdd,
} from "./platforms/x/xStreamTypes.js";
import { mapTweetToPost } from "./platforms/x/xResultMapper.js";
import type { XApiTweet, XApiIncludes } from "./platforms/x/xApiClient.js";
import type { IRawPost } from "../utils/kolCrawlResultParser.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IStreamHealth {
  connected: boolean;
  lastEventAt: Date | null;
  reconnectCount: number;
  activeRuleCount: number;
}

export type StreamPostCallback = (rawPost: IRawPost, kolId: string) => Promise<void>;

// ── Rule management ───────────────────────────────────────────────────────────

const KOL_RULE_TAG_PREFIX = "kol-stream-";
const IDS_PER_RULE = 15;
const MAX_RULES = 25;

function buildStreamRules(kols: IKolProfile[]): IStreamRuleAdd[] {
  const withId = kols.filter(k => k.x_user_id);
  const missing = kols.length - withId.length;
  if (missing > 0) {
    log.warn(`[KolStream] ${missing} KOLs missing x_user_id — skipped from stream rules`);
  }

  // Prioritize Tier S over A if we hit the rule cap
  const sorted = [...withId].sort((a, b) => (a.tier === "S" ? -1 : b.tier === "S" ? 1 : 0));
  const maxIds = MAX_RULES * IDS_PER_RULE;
  if (sorted.length > maxIds) {
    log.error(`[KolStream] ${sorted.length} KOLs exceed max capacity (${maxIds}), truncating to Tier S priority`);
  }
  const capped = sorted.slice(0, maxIds);

  const rules: IStreamRuleAdd[] = [];
  for (let i = 0; i < capped.length; i += IDS_PER_RULE) {
    const chunk = capped.slice(i, i + IDS_PER_RULE);
    const fromClause = chunk.map(k => `from:${k.x_user_id!}`).join(" OR ");
    rules.push({
      value: `(${fromClause}) -is:retweet`,
      tag: `${KOL_RULE_TAG_PREFIX}${Math.floor(i / IDS_PER_RULE)}`,
    });
  }
  return rules;
}

export async function syncRules(kols: IKolProfile[]): Promise<void> {
  const current = await getStreamRules();
  const toDelete = current
    .filter(r => r.tag?.startsWith(KOL_RULE_TAG_PREFIX))
    .map(r => r.id);

  const desired = buildStreamRules(kols);
  // Add new rules first to avoid a gap window where no rules are active
  if (desired.length) await addStreamRules(desired);
  if (toDelete.length) await deleteStreamRules(toDelete);

  health.activeRuleCount = desired.length;
  log.info(`[KolStream] Rules synced — ${desired.length} rules for ${kols.filter(k => k.x_user_id).length} KOLs`);
}

// ── Stream event parsing ──────────────────────────────────────────────────────

interface StreamEvent {
  data?: XApiTweet;
  includes?: XApiIncludes;
}

function parseStreamEvent(line: string): StreamEvent | null {
  try {
    return JSON.parse(line) as StreamEvent;
  } catch {
    log.debug(`[KolStream] Malformed event line: ${line.slice(0, 80)}`);
    return null;
  }
}

// ── Connection state ──────────────────────────────────────────────────────────

const health: IStreamHealth = {
  connected: false,
  lastEventAt: null,
  reconnectCount: 0,
  activeRuleCount: 0,
};

let disconnectFn: (() => void) | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let activeCallback: StreamPostCallback | null = null;
let activeKolIdMap: Map<string, string> | null = null;

const HEARTBEAT_TIMEOUT_MS = 60_000;

function resetHeartbeat(attempt: number): void {
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => {
    log.warn("[KolStream] Heartbeat timeout — reconnecting");
    disconnectFn?.();
    scheduleReconnect(attempt + 1);
  }, HEARTBEAT_TIMEOUT_MS);
}

// ── Connect / disconnect ──────────────────────────────────────────────────────

export async function connect(
  onPost: StreamPostCallback,
  kolIdMap: Map<string, string>,
): Promise<void> {
  activeCallback = onPost;
  activeKolIdMap = kolIdMap;
  await openStream(0);
}

export function updateKolIdMap(newMap: Map<string, string>): void {
  activeKolIdMap = newMap;
}

async function openStream(attempt: number): Promise<void> {
  let lineBuffer = "";

  try {
    disconnectFn = await connectFilteredStream(
      (chunk) => {
        health.lastEventAt = new Date();
        resetHeartbeat(attempt);
        lineBuffer += chunk;
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const event = parseStreamEvent(trimmed);
          if (!event?.data || !event.data.author_id) continue;

          const kolId = activeKolIdMap?.get(event.data.author_id);
          if (!kolId) continue;

          // Resolve handle from stream includes for a proper post_url
          const author = event.includes?.users?.find(u => u.id === event.data!.author_id);
          const handle = author?.username ?? `i/web/status`;
          const rawPost = mapTweetToPost(event.data, handle, event.includes);

          if (activeCallback) {
            activeCallback(rawPost, kolId).catch(err => {
              log.error(`[KolStream] Post callback error: ${(err as Error).message}`);
            });
          }
        }
      },
      (err) => {
        health.connected = false;
        if (heartbeatTimer) clearTimeout(heartbeatTimer);
        log.error(`[KolStream] Stream error: ${err.message}`);
        scheduleReconnect(attempt + 1);
      },
    );

    health.connected = true;
    health.reconnectCount = attempt > 0 ? health.reconnectCount + 1 : health.reconnectCount;
    resetHeartbeat(attempt);
    log.info(`[KolStream] Connected (attempt ${attempt})`);
  } catch (err) {
    health.connected = false;
    log.error(`[KolStream] Connect failed: ${(err as Error).message}`);
    scheduleReconnect(attempt + 1);
  }
}

function scheduleReconnect(attempt: number): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delay = Math.min(1000 * Math.pow(2, attempt - 1), 300_000);
  log.info(`[KolStream] Reconnecting in ${delay}ms (attempt ${attempt})`);
  reconnectTimer = setTimeout(() => openStream(attempt), delay);
}

export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (heartbeatTimer) {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (disconnectFn) {
    disconnectFn();
    disconnectFn = null;
  }
  health.connected = false;
  log.info("[KolStream] Disconnected");
}

export function getStreamHealth(): IStreamHealth {
  return { ...health };
}
