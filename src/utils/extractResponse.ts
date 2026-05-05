import { RESPONSE_DELIMITERS } from "../prompts/outputFormat.js";

/**
 * Extract the actual response payload from raw OpenClaw CLI output.
 * Uses delimiter markers injected by prompts; falls back to JSON extraction.
 */
export function extractResponse(rawOutput: string): string {
  const { start, end } = RESPONSE_DELIMITERS;

  const startIdx = rawOutput.indexOf(start);
  const endIdx = rawOutput.indexOf(end);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return rawOutput.slice(startIdx + start.length, endIdx).trim();
  }

  const jsonStart = rawOutput.indexOf("{");
  const jsonEnd = rawOutput.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    const candidate = rawOutput.slice(jsonStart, jsonEnd + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // not valid JSON, fall through
    }
  }

  return rawOutput.trim();
}
