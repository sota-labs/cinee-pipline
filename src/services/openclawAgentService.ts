/**
 * AI rewrite must use `openclaw agent --json`: plain stdout often ends with log lines
 * like "completed" / summary, not the generated text. Real content is in
 * `result.payloads[].text`.
 */
import { execSync } from "child_process";
import { settings } from "../config/settings.js";

interface AgentJsonPayload {
  text?: string | null;
}

interface AgentJsonResult {
  summary?: string;
  status?: string;
  result?: {
    payloads?: AgentJsonPayload[];
  };
}

function extractTextFromParsed(parsed: AgentJsonResult): string {
  const payloads = parsed.result?.payloads ?? [];
  const parts = payloads
    .map((p) => (typeof p.text === "string" ? p.text.trim() : ""))
    .filter(Boolean);
  return parts.join("\n\n").trim();
}

function parseAgentStdout(stdout: string): AgentJsonResult {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as AgentJsonResult;
  } catch {
    const lastBrace = trimmed.lastIndexOf("{");
    if (lastBrace === -1) {
      throw new Error("OpenClaw --json output: no JSON object found");
    }
    return JSON.parse(trimmed.slice(lastBrace)) as AgentJsonResult;
  }
}

/** Run agent with --json and return assistant-generated text (not status/summary). */
export function runOpenClawAgentText(message: string): string {
  const escaped = message.replace(/'/g, "'\\''");
  const stdout = execSync(
    `openclaw agent --agent ${settings.openClawAgent} --message '${escaped}' --json`,
    {
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: 300_000,
    },
  );

  const parsed = parseAgentStdout(stdout);
  const text = extractTextFromParsed(parsed);
  if (!text) {
    throw new Error(
      `OpenClaw returned empty assistant text (status=${parsed.status ?? "?"}, summary=${parsed.summary ?? "?"})`,
    );
  }
  return text;
}
