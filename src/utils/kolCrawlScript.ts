/**
 * Scripts for Twitter/X DOM extraction, run inside browser via OpenClaw's page.evaluate().
 * IMPORTANT: These are raw JS strings — no TypeScript, no imports.
 *
 * sinceTimestamp is embedded directly into the script string (not passed as argument)
 * because page.evaluate with a string expression does not support extra arguments.
 */

const TWEET_SCRIPT_BODY = `
  function parseCount(str) {
    if (!str) return 0;
    const s = str.replace(/,/g, '').trim();
    if (s.endsWith('K')) return Math.round(parseFloat(s) * 1000);
    if (s.endsWith('M')) return Math.round(parseFloat(s) * 1000000);
    return parseInt(s) || 0;
  }
  const sinceDate = SINCE_PLACEHOLDER ? new Date(SINCE_PLACEHOLDER) : null;
  const tweets = [...document.querySelectorAll('[data-testid="tweet"]')];
  let shouldStop = false;
  const posts = tweets.map(t => {
    const timeEl = t.querySelector('time');
    const linkEl = timeEl?.closest('a');
    return {
      post_url: linkEl ? 'https://x.com' + linkEl.getAttribute('href') : '',
      content: t.querySelector('[data-testid="tweetText"]')?.innerText?.slice(0, 500) || '',
      posted_at: timeEl?.getAttribute('datetime') || '',
      likes: parseCount(t.querySelector('[data-testid="like"] span')?.innerText),
      comments: parseCount(t.querySelector('[data-testid="reply"] span')?.innerText),
      retweets: parseCount(t.querySelector('[data-testid="retweet"] span')?.innerText),
      views: parseCount(t.querySelector('[data-testid="analytics"] span')?.innerText),
      media_urls: [...t.querySelectorAll('[data-testid="tweetPhoto"] img, [data-testid="videoPlayer"] video')]
                    .map(el => el.src || el.poster).filter(Boolean),
      is_retweet: !!t.querySelector('[data-testid="socialContext"]')?.innerText?.toLowerCase().includes('reposted'),
      is_quote: !!t.querySelector('[data-testid="quoteTweet"]'),
      quoted_post_url: t.querySelector('[data-testid="quoteTweet"] a[href*="/status/"]')?.href || '',
    };
  }).filter(p => {
    if (p.posted_at && sinceDate && new Date(p.posted_at) <= sinceDate) {
      shouldStop = true;
      return false;
    }
    return p.content &&
      p.post_url &&
      p.posted_at &&
      !p.is_retweet &&
      !(p.is_quote && p.content.length < 30) &&
      p.content.length >= 15;
  });
  return { posts, shouldStop };
`;

/**
 * Build a self-contained IIFE tweet script with sinceTimestamp embedded.
 * Returns { posts: [...], shouldStop: boolean }
 */
export function buildTweetScript(sinceTimestamp: string): string {
  const escaped = sinceTimestamp.replace(/"/g, '\\"');
  return `(function() {\n${TWEET_SCRIPT_BODY.replace(/SINCE_PLACEHOLDER/g, `"${escaped}"`)}\n})()`;
}

// Run on a post detail page — skip index 0 (original tweet), take next 10 (top comments)
export const KOL_COMMENT_SCRIPT = `
(function() {
  function parseCount(str) {
    if (!str) return 0;
    const s = str.replace(/,/g, '').trim();
    if (s.endsWith('K')) return Math.round(parseFloat(s) * 1000);
    if (s.endsWith('M')) return Math.round(parseFloat(s) * 1000000);
    return parseInt(s) || 0;
  }
  const items = [...document.querySelectorAll('[data-testid="tweet"]')].slice(1, 11);
  return items.map(c => {
    const text = c.innerText || '';
    const isHidden = text.toLowerCase().includes('show more replies') || text.toLowerCase().includes('hidden');
    const isSpam = text.toLowerCase().includes('probable spam');
    return {
      content: c.querySelector('[data-testid="tweetText"]')?.innerText?.slice(0, 300) || '',
      author_handle: (c.querySelector('[data-testid="User-Name"] a')?.href || '').split('/').pop() || '',
      likes: parseCount(c.querySelector('[data-testid="like"] span')?.innerText),
      reply_count: parseCount(c.querySelector('[data-testid="reply"] span')?.innerText),
      is_hidden: isHidden,
      is_spam: isSpam
    };
  }).filter(c => c.content);
})()
`;
