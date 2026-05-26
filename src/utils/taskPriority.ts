const TIER_PRIORITY: Record<string, number> = { S: 40, A: 30, B: 20, C: 10 };

// Pipeline tasks (comment→analyze→reply) get +5 over crawl tasks of the same tier
// so they always run before the next batch crawl even when priorities are equal
const PIPELINE_BOOST = 5;

export function tierToPriority(tier: string): number {
  return TIER_PRIORITY[tier] ?? 10;
}

export function tierToPipelinePriority(tier: string): number {
  return tierToPriority(tier) + PIPELINE_BOOST;
}
