/** Pure skip-rule evaluation for AFK mode — no DB access, no side effects. */

const DEX_DOMAINS = /dextools\.io|dexscreener\.com|pump\.fun|letsbonk\.fun/i;

// Solana base58 address: 32-44 chars, isolated (not part of a longer word)
const SOLANA_CA = /(^|[\s,;([\]])([1-9A-HJ-NP-Za-km-z]{32,44})([\s,;)\]]|$)/;

// EVM address: 0x + 40 hex chars
const EVM_CA = /0x[a-fA-F0-9]{40}/i;

// Sui object ID: 0x + 64 hex chars
const SUI_CA = /0x[a-fA-F0-9]{64}/i;

// Cashtag: $SYMBOL (2-10 uppercase letters), requires word boundary before $
const CASHTAG_RE = /(?:^|[\s,;([\]])\$([A-Z]{2,10})(?:[\s,;)\]]|$)/g;

export interface ISkipRuleParams {
  content: string;
  isRetweet: boolean;
  isQuote: boolean;
  quotedPostUrl?: string;
  cashtagWhitelist: string[]; // uppercase, no $
}

/**
 * Returns true if the post should be skipped in AFK mode.
 * Caller is responsible for checking KOL tier before calling this.
 */
export function shouldSkipPost(params: ISkipRuleParams): boolean {
  const { content, isRetweet, isQuote, quotedPostUrl, cashtagWhitelist } = params;

  // Rule 1: retweet/repost
  if (isRetweet) return true;

  // Rule 2: cashtag not in whitelist
  const whitelist = new Set(cashtagWhitelist.map((t) => t.toUpperCase()));
  CASHTAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CASHTAG_RE.exec(content)) !== null) {
    if (!whitelist.has(match[1])) return true;
  }

  // Rule 3: contract address
  if (EVM_CA.test(content)) return true;
  if (SUI_CA.test(content)) return true;
  if (SOLANA_CA.test(content)) return true;

  // Rule 4: DEX/pump domain in content
  if (DEX_DOMAINS.test(content)) return true;

  // Rule 5: quote tweet whose quoted URL contains a DEX domain
  if (isQuote && quotedPostUrl && DEX_DOMAINS.test(quotedPostUrl)) return true;

  return false;
}
