const TIER_PRIORITY: Record<string, number> = { S: 40, A: 30, B: 20, C: 10 };

export function tierToPriority(tier: string): number {
  return TIER_PRIORITY[tier] ?? 10;
}
