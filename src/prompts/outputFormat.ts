export const RESPONSE_DELIMITERS = {
  start: "<<<RESPONSE_START>>>",
  end: "<<<RESPONSE_END>>>",
} as const;

export const OUTPUT_FORMAT_INSTRUCTION = `

CRITICAL OUTPUT FORMAT REQUIREMENT:
You MUST wrap your FINAL response between these exact markers on their own lines:
<<<RESPONSE_START>>>
(your response here — JSON or plain text as specified above)
<<<RESPONSE_END>>>
Do NOT include anything outside these markers. Only the content between the markers will be processed.`;
