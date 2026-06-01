/** X Filtered Stream API types and client methods */
import { settings } from "../../../config/settings.js";
import { XRateLimitError } from "./xApiClient.js";

const X_API_BASE = "https://api.twitter.com/2";

// ── Stream types ──────────────────────────────────────────────────────────────

export interface IStreamRule {
  id: string;
  value: string;
  tag?: string;
}

export interface IStreamRuleAdd {
  value: string;
  tag?: string;
}

// ── Stream rules API ──────────────────────────────────────────────────────────

export async function getStreamRules(): Promise<IStreamRule[]> {
  const res = await fetch(`${X_API_BASE}/tweets/search/stream/rules`, {
    headers: { Authorization: `Bearer ${settings.xApiBearerToken}` },
  });
  if (res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    throw new XRateLimitError(reset ? new Date(parseInt(reset, 10) * 1000) : new Date(Date.now() + 15 * 60 * 1000));
  }
  if (!res.ok) throw new Error(`Stream rules fetch failed: ${res.status}`);
  const data = await res.json() as { data?: IStreamRule[] };
  return data.data ?? [];
}

export async function addStreamRules(rules: IStreamRuleAdd[]): Promise<IStreamRule[]> {
  if (rules.length === 0) return [];
  const res = await fetch(`${X_API_BASE}/tweets/search/stream/rules`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.xApiBearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ add: rules }),
  });
  if (res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    throw new XRateLimitError(reset ? new Date(parseInt(reset, 10) * 1000) : new Date(Date.now() + 15 * 60 * 1000));
  }
  if (!res.ok) throw new Error(`Stream rules add failed: ${res.status}`);
  const data = await res.json() as { data?: IStreamRule[] };
  return data.data ?? [];
}

export async function deleteStreamRules(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const res = await fetch(`${X_API_BASE}/tweets/search/stream/rules`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.xApiBearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ delete: { ids } }),
  });
  if (res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    throw new XRateLimitError(reset ? new Date(parseInt(reset, 10) * 1000) : new Date(Date.now() + 15 * 60 * 1000));
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Stream rules delete failed: ${res.status} — ${body}`);
  }
}

// ── Filtered stream connection ────────────────────────────────────────────────

const STREAM_URL =
  `${X_API_BASE}/tweets/search/stream` +
  "?tweet.fields=referenced_tweets,public_metrics,entities,attachments,created_at,author_id" +
  "&expansions=attachments.media_keys,author_id" +
  "&user.fields=id,username" +
  "&media.fields=url,type";

export async function connectFilteredStream(
  onData: (chunk: string) => void,
  onError: (err: Error) => void,
): Promise<() => void> {
  const res = await fetch(STREAM_URL, {
    headers: { Authorization: `Bearer ${settings.xApiBearerToken}` },
  });

  if (res.status === 429) {
    const reset = res.headers.get("x-ratelimit-reset");
    throw new XRateLimitError(reset ? new Date(parseInt(reset, 10) * 1000) : new Date(Date.now() + 15 * 60 * 1000));
  }
  if (!res.ok) throw new Error(`Stream connect failed: ${res.status}`);
  if (!res.body) throw new Error("No response body from stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let active = true;

  (async () => {
    try {
      while (active) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk.trim()) onData(chunk);
      }
    } catch (err) {
      if (active) onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return () => {
    active = false;
    reader.cancel().catch(() => {});
  };
}
