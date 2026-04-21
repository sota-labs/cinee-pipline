export const KOL_CONSTANTS = {
  MAX_WRITING_SAMPLES: 50,
  MIN_SAMPLES_FOR_STYLE_LEARN: 10,
  ENGAGEMENT_WEIGHTS: Object.freeze({ like: 2, reply: 3, share: 4 }),
  DEFAULT_CRAWL_CADENCE_MIN: 45,
  CRAWL_BATCH_SIZE_DEFAULT: 10,
  CRAWL_BATCH_SIZE_MAX: 20,
  TOP_COMMENT_COUNT: 10,
  COMMENT_CANDIDATE_COUNT: 3,
  VISIBILITY_CHECK_COUNT: 3,
  VISIBILITY_CHECK_INTERVAL_MS: 5 * 60 * 1000,
  DEFAULT_TRUST_THRESHOLDS: Object.freeze({ high: 0.7, medium: 0.4, low: 0.2 }),
  DEFAULT_REPLY_RATE_LIMIT_MIN: 1,
  DEFAULT_REPLY_RATE_LIMIT_MAX: 3,
  BOT_RISK_MAX_FOLLOWING_RATIO: 50,
  TIMEOUT_FALLBACK_DELAY_MS: 5 * 60 * 1000,
} as const;

export const getApiUrl = (): string =>
  process.env.PUBLIC_API_URL ?? 'http://localhost:3000';

export const BULL_QUEUES = {
  KOL_CRAWL: 'kol-crawl',
  AI_PIPELINE: 'ai-pipeline',
  TELEGRAM_APPROVAL: 'telegram-approval',
  ENGAGEMENT: 'engagement',
} as const;
