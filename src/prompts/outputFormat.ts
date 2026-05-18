export const RESPONSE_DELIMITERS = {
  start: "<<<RESPONSE_START>>>",
  end: "<<<RESPONSE_END>>>",
} as const;

export const OUTPUT_FORMAT_INSTRUCTION = `

CRITICAL EXECUTION RULES:
- You are a browser automation agent. EXECUTE the steps above immediately using your browser tools.
- Do NOT explain what you are going to do. Do NOT describe the task. Do NOT ask for confirmation.
- Do NOT say "I will", "I would", "Let me", or any planning language.
- If a browser tool is available, USE IT NOW. If not, return an error in the response format below.
- Start executing step 1 immediately.

CRITICAL OUTPUT FORMAT:
After completing all steps, wrap your FINAL response between these exact markers on their own lines:
<<<RESPONSE_START>>>
(your response here — JSON as specified above)
<<<RESPONSE_END>>>
Do NOT include anything outside these markers.`;
