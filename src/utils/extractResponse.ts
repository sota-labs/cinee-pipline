import { RESPONSE_DELIMITERS } from "../prompts/outputFormat.js";

/**
 * Extract the actual response payload from raw OpenClaw CLI output.
 * Uses delimiter markers injected by prompts; falls back to JSON extraction.
 */
export function extractResponse(rawOutput: string): string {
  const { start, end } = RESPONSE_DELIMITERS;

  const startIdx = rawOutput.indexOf(start);
  const endIdx = rawOutput.indexOf(end);

  let extracted: string;

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    extracted = rawOutput.slice(startIdx + start.length, endIdx).trim();
  } else {
    extracted = rawOutput.trim();
  }

  // Fast path: already valid JSON
  try {
    JSON.parse(extracted);
    return extracted;
  } catch {
    // not plain JSON — continue
  }

  // Strip markdown code block wrapper (```json ... ``` or ``` ... ```)
  const codeBlockMatch = extracted.match(/^```(?:json|javascript|js)?\s*\n?([\s\S]*?)\n?```$/);
  if (codeBlockMatch) {
    extracted = codeBlockMatch[1].trim();
    // Validate after stripping
    try {
      JSON.parse(extracted);
      return extracted;
    } catch {
      // fall through to JSON extraction
    }
  }

  // Last resort: find first valid JSON object in the string
  const jsonStart = extracted.indexOf("{");
  const jsonEnd = extracted.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    const candidate = extracted.slice(jsonStart, jsonEnd + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // not valid JSON
    }
  }

  return extracted;
}
