/** Human-like writing style rules — injected into all content-generating prompts. */

export type HumanStyleLevel = "mild" | "moderate" | "heavy";

/**
 * Returns a writing rules block to inject into prompts, tuned by intensity level.
 *
 * mild    — acronyms + casual tone, no typos
 * moderate — acronyms + 1-2 intentional typos + informal punctuation (no ; or ...)
 * heavy   — full casual mode: typos, fragments, lowercase, run-ons, dropped apostrophes
 */
export function getHumanStyleRules(level: HumanStyleLevel = "moderate"): string {
  const base = `
HUMAN WRITING STYLE — follow these EXACTLY:
- Write like a real person typing on their phone, not a polished AI output
- Use casual internet language and acronyms naturally where they fit: lol, ngl, imo, tbh, smh, fr, rn, lowkey, highkey, idk, nbd
- NEVER use semicolons (;) — they read as robotic and formal
- NEVER use ellipsis (...) — it looks like an AI trailing off
- NEVER use formal transitions like "Furthermore", "Moreover", "Additionally", "In conclusion"
- NO corporate or polished language — no "leverage", "synergy", "utilize", "facilitate"
- Vary sentence length dramatically — some sentences can be fragments. Like this. Others can run on longer when excited about something
- End with a question or observation, not a period if you can help it`;

  if (level === "mild") {
    return base;
  }

  const moderateExtra = `
- Occasional intentional typos are OK (1-2 per post max, not every post): "teh" for "the", "becuase", "definately", "wierd", "alot"
- Skip formal punctuation sometimes — a comma where a period would be is fine
- Lowercase is fine for non-proper nouns — dont always capitalize every sentence start`;

  if (level === "moderate") {
    return base + moderateExtra;
  }

  // heavy
  const heavyExtra = `
- Frequent intentional typos (2-3 per post): "teh", "becuase", "definately", "wierd", "alot", "recieve", "occured"
- Often drop apostrophes: "dont", "cant", "wont", "im", "youre", "its" (non-possessive)
- Incomplete thoughts are fine — leave some sentences as fragments
- Run-on sentences when excited: "this is actually so good i cant believe nobody is talking about it rn"
- Use very little capitalization — almost none outside of proper nouns`;

  return base + moderateExtra + heavyExtra;
}
