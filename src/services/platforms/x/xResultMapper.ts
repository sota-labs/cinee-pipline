/** Maps X API v2 tweet objects to internal IRawPost / IComment formats */
import { IRawPost } from "../../../utils/kolCrawlResultParser.js";
import { IComment } from "../../kolCrawlerService.js";
import { XApiTweet, XApiIncludes } from "./xApiClient.js";

function resolveMediaUrls(mediaKeys: string[] | undefined, includes: XApiIncludes | undefined): string[] {
  if (!mediaKeys?.length || !includes?.media?.length) return [];
  return mediaKeys
    .map(key => includes.media!.find(m => m.media_key === key)?.url)
    .filter((url): url is string => !!url);
}

function resolveQuotedUrl(tweet: XApiTweet): string | undefined {
  const quoted = tweet.referenced_tweets?.find(r => r.type === "quoted");
  if (!quoted) return undefined;
  // Best-effort: we don't have the author handle in includes for quoted tweets
  // Return a partial URL with just the tweet ID — downstream can resolve if needed
  return `https://x.com/i/web/status/${quoted.id}`;
}

export function mapTweetToPost(
  tweet: XApiTweet,
  handle: string,
  includes?: XApiIncludes,
): IRawPost {
  const isRetweet = tweet.referenced_tweets?.some(r => r.type === "retweeted") ?? false;
  const isQuote = tweet.referenced_tweets?.some(r => r.type === "quoted") ?? false;

  return {
    post_url: `https://x.com/${handle}/status/${tweet.id}`,
    content: tweet.text,
    posted_at: tweet.created_at ?? new Date().toISOString(),
    likes: tweet.public_metrics?.like_count ?? 0,
    comments: tweet.public_metrics?.reply_count ?? 0,
    retweets: tweet.public_metrics?.retweet_count ?? 0,
    views: tweet.public_metrics?.impression_count ?? 0,
    media_urls: resolveMediaUrls(tweet.attachments?.media_keys, includes),
    is_retweet: isRetweet,
    is_quote: isQuote,
    quoted_post_url: isQuote ? resolveQuotedUrl(tweet) : undefined,
  };
}

export function mapRepliesToComments(
  tweets: XApiTweet[],
  includes?: XApiIncludes,
): IComment[] {
  return tweets.map(tweet => {
    const author = includes?.users?.find(u => u.id === tweet.author_id);
    return {
      content: tweet.text,
      author_handle: author ? `@${author.username}` : `@unknown`,
      likes: tweet.public_metrics?.like_count ?? 0,
      reply_count: tweet.public_metrics?.reply_count ?? 0,
    };
  });
}
