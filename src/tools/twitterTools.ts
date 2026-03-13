/** Twitter API Tools — ported from twitter_tools.py using twitter-api-v2. */
import { TwitterApi } from "twitter-api-v2";
import { settings } from "../config/settings.js";

function getTwitterClient(): TwitterApi {
  return new TwitterApi({
    appKey: settings.twitter.apiKey,
    appSecret: settings.twitter.apiSecret,
    accessToken: settings.twitter.accessToken,
    accessSecret: settings.twitter.accessSecret,
  });
}

function getReadOnlyClient(): TwitterApi {
  return new TwitterApi(settings.twitter.bearerToken);
}

export async function postTweet(
  text: string,
  mediaIds?: string[]
): Promise<Record<string, unknown>> {
  const client = getTwitterClient();
  try {
    const params: Record<string, unknown> = { text };
    if (mediaIds?.length) {
      params.media = { media_ids: mediaIds };
    }
    const result = await client.v2.tweet(params as any);
    const tweetId = result.data.id;
    return { success: true, tweet_id: tweetId, url: `https://twitter.com/i/status/${tweetId}` };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function replyToTweet(
  text: string,
  tweetId: string
): Promise<Record<string, unknown>> {
  const client = getTwitterClient();
  try {
    const result = await client.v2.reply(text, tweetId);
    const replyId = result.data.id;
    return { success: true, reply_id: replyId, url: `https://twitter.com/i/status/${replyId}` };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function getMentions(
  maxResults = 10,
  sinceId?: string | null
): Promise<Record<string, unknown>[]> {
  const client = getTwitterClient();
  try {
    const me = await client.v2.me();
    const userId = me.data.id;

    const params: Record<string, unknown> = {
      max_results: maxResults,
      "tweet.fields": ["author_id", "created_at", "conversation_id", "in_reply_to_user_id"],
      expansions: ["author_id", "referenced_tweets.id"],
    };
    if (sinceId) params.since_id = sinceId;

    const mentions = await client.v2.userMentionTimeline(userId, params as any);

    const results: Record<string, unknown>[] = [];
    if (mentions.data?.data) {
      for (const tweet of mentions.data.data) {
        results.push({
          tweet_id: tweet.id,
          text: tweet.text,
          author_id: tweet.author_id,
          created_at: tweet.created_at,
          conversation_id: tweet.conversation_id,
        });
      }
    }
    return results;
  } catch (e: any) {
    return [{ error: e.message }];
  }
}

export async function likeTweet(tweetId: string): Promise<Record<string, unknown>> {
  const client = getTwitterClient();
  try {
    const me = await client.v2.me();
    await client.v2.like(me.data.id, tweetId);
    return { success: true, tweet_id: tweetId };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function retweetTweet(tweetId: string): Promise<Record<string, unknown>> {
  const client = getTwitterClient();
  try {
    const me = await client.v2.me();
    await client.v2.retweet(me.data.id, tweetId);
    return { success: true, tweet_id: tweetId };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export async function getTweetDetails(tweetId: string): Promise<Record<string, unknown>> {
  const client = getReadOnlyClient();
  try {
    const result = await client.v2.singleTweet(tweetId, {
      "tweet.fields": ["author_id", "created_at", "public_metrics", "conversation_id"],
      expansions: ["author_id"],
    });

    if (result.data) {
      const metrics = (result.data.public_metrics || {}) as Record<string, number>;
      return {
        tweet_id: result.data.id,
        text: result.data.text,
        author_id: result.data.author_id,
        created_at: result.data.created_at,
        likes: metrics.like_count ?? 0,
        retweets: metrics.retweet_count ?? 0,
        replies: metrics.reply_count ?? 0,
        quotes: metrics.quote_count ?? 0,
      };
    }
    return { error: "Tweet not found" };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function getTrendingTopics(
  _woeid = 1
): Promise<Record<string, unknown>[]> {
  // Twitter API v2 doesn't have a direct trends endpoint for free tier.
  // This is a placeholder that returns an empty list.
  // In production, use the v1.1 endpoint or a third-party trends service.
  return [{ error: "Trends API requires elevated access" }];
}

export async function searchTweets(
  query: string,
  maxResults = 10
): Promise<Record<string, unknown>[]> {
  const client = getReadOnlyClient();
  try {
    const result = await client.v2.search(query, {
      max_results: maxResults,
      "tweet.fields": ["author_id", "created_at", "public_metrics"],
    });

    const tweets: Record<string, unknown>[] = [];
    if (result.data?.data) {
      for (const tweet of result.data.data) {
        tweets.push({
          tweet_id: tweet.id,
          text: tweet.text,
          author_id: tweet.author_id,
          created_at: tweet.created_at,
          public_metrics: tweet.public_metrics,
        });
      }
    }
    return tweets;
  } catch (e: any) {
    return [{ error: e.message }];
  }
}

export async function quoteTweet(
  text: string,
  tweetId: string
): Promise<Record<string, unknown>> {
  const client = getTwitterClient();
  try {
    const result = await client.v2.tweet({
      text,
      quote_tweet_id: tweetId,
    } as any);
    const newId = result.data.id;
    return { success: true, tweet_id: newId, url: `https://twitter.com/i/status/${newId}` };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}
