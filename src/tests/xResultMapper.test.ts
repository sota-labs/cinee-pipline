import { describe, it, expect } from "vitest";
import { mapTweetToPost, mapRepliesToComments } from "../services/platforms/x/xResultMapper.js";
import type { XApiTweet, XApiMedia, XApiUser } from "../services/platforms/x/xApiClient.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseTweet: XApiTweet = {
  id: "1234567890",
  text: "This is a normal tweet about crypto",
  created_at: "2026-05-29T10:00:00.000Z",
  author_id: "user_001",
  public_metrics: {
    like_count: 42,
    reply_count: 7,
    retweet_count: 15,
    impression_count: 1200,
    quote_count: 3,
  },
};

// ── mapTweetToPost ────────────────────────────────────────────────────────────

describe("mapTweetToPost", () => {
  it("maps a normal tweet with all metrics", () => {
    const result = mapTweetToPost(baseTweet, "cryptokol");

    expect(result.post_url).toBe("https://x.com/cryptokol/status/1234567890");
    expect(result.content).toBe("This is a normal tweet about crypto");
    expect(result.posted_at).toBe("2026-05-29T10:00:00.000Z");
    expect(result.likes).toBe(42);
    expect(result.comments).toBe(7);
    expect(result.retweets).toBe(15);
    expect(result.views).toBe(1200);
    expect(result.is_retweet).toBe(false);
    expect(result.is_quote).toBe(false);
    expect(result.quoted_post_url).toBeUndefined();
    expect(result.media_urls).toEqual([]);
  });

  it("detects a retweet via referenced_tweets type=retweeted", () => {
    const retweet: XApiTweet = {
      ...baseTweet,
      id: "9999",
      text: "RT @someone: original tweet content",
      referenced_tweets: [{ type: "retweeted", id: "original_001" }],
    };

    const result = mapTweetToPost(retweet, "cryptokol");

    expect(result.is_retweet).toBe(true);
    expect(result.is_quote).toBe(false);
    expect(result.post_url).toBe("https://x.com/cryptokol/status/9999");
  });

  it("detects a quote tweet via referenced_tweets type=quoted", () => {
    const quoteTweet: XApiTweet = {
      ...baseTweet,
      id: "8888",
      text: "My take on this: great insight",
      referenced_tweets: [{ type: "quoted", id: "quoted_tweet_001" }],
    };

    const result = mapTweetToPost(quoteTweet, "cryptokol");

    expect(result.is_quote).toBe(true);
    expect(result.is_retweet).toBe(false);
    expect(result.quoted_post_url).toBe("https://x.com/i/web/status/quoted_tweet_001");
  });

  it("resolves media URLs from includes.media", () => {
    const tweetWithMedia: XApiTweet = {
      ...baseTweet,
      id: "7777",
      attachments: { media_keys: ["media_key_1", "media_key_2"] },
    };

    const media: XApiMedia[] = [
      { media_key: "media_key_1", type: "photo", url: "https://pbs.twimg.com/media/img1.jpg" },
      { media_key: "media_key_2", type: "photo", url: "https://pbs.twimg.com/media/img2.jpg" },
      { media_key: "media_key_3", type: "photo", url: "https://pbs.twimg.com/media/img3.jpg" },
    ];

    const result = mapTweetToPost(tweetWithMedia, "cryptokol", { media });

    expect(result.media_urls).toHaveLength(2);
    expect(result.media_urls).toContain("https://pbs.twimg.com/media/img1.jpg");
    expect(result.media_urls).toContain("https://pbs.twimg.com/media/img2.jpg");
  });

  it("skips media keys that have no matching entry in includes.media", () => {
    const tweetWithMedia: XApiTweet = {
      ...baseTweet,
      attachments: { media_keys: ["missing_key"] },
    };

    const media: XApiMedia[] = [
      { media_key: "other_key", type: "photo", url: "https://pbs.twimg.com/media/other.jpg" },
    ];

    const result = mapTweetToPost(tweetWithMedia, "cryptokol", { media });

    expect(result.media_urls).toEqual([]);
  });

  it("defaults all metrics to 0 when public_metrics is missing", () => {
    const noMetricsTweet: XApiTweet = {
      id: "6666",
      text: "Tweet without metrics",
    };

    const result = mapTweetToPost(noMetricsTweet, "cryptokol");

    expect(result.likes).toBe(0);
    expect(result.comments).toBe(0);
    expect(result.retweets).toBe(0);
    expect(result.views).toBe(0);
  });

  it("uses current ISO string for posted_at when created_at is missing", () => {
    const noDateTweet: XApiTweet = {
      id: "5555",
      text: "Tweet without date",
    };

    const before = Date.now();
    const result = mapTweetToPost(noDateTweet, "cryptokol");
    const after = Date.now();

    const postedAt = new Date(result.posted_at).getTime();
    expect(postedAt).toBeGreaterThanOrEqual(before);
    expect(postedAt).toBeLessThanOrEqual(after);
  });

  it("returns empty media_urls when attachments is undefined", () => {
    const result = mapTweetToPost(baseTweet, "cryptokol");
    expect(result.media_urls).toEqual([]);
  });

  it("returns empty media_urls when includes has no media array", () => {
    const tweetWithMedia: XApiTweet = {
      ...baseTweet,
      attachments: { media_keys: ["key1"] },
    };

    const result = mapTweetToPost(tweetWithMedia, "cryptokol", { users: [] });
    expect(result.media_urls).toEqual([]);
  });
});

// ── mapRepliesToComments ──────────────────────────────────────────────────────

describe("mapRepliesToComments", () => {
  const replyTweets: XApiTweet[] = [
    {
      id: "reply_001",
      text: "Great post!",
      author_id: "user_101",
      public_metrics: { like_count: 5, reply_count: 1, retweet_count: 0 },
    },
    {
      id: "reply_002",
      text: "I disagree with this take",
      author_id: "user_102",
      public_metrics: { like_count: 12, reply_count: 3, retweet_count: 0 },
    },
  ];

  const users: XApiUser[] = [
    { id: "user_101", username: "alice" },
    { id: "user_102", username: "bob" },
  ];

  it("resolves author_handle from includes.users", () => {
    const result = mapRepliesToComments(replyTweets, { users });

    expect(result).toHaveLength(2);
    expect(result[0].author_handle).toBe("@alice");
    expect(result[1].author_handle).toBe("@bob");
  });

  it("falls back to @unknown when author_id not in includes.users", () => {
    const result = mapRepliesToComments(replyTweets, { users: [] });

    expect(result[0].author_handle).toBe("@unknown");
    expect(result[1].author_handle).toBe("@unknown");
  });

  it("falls back to @unknown when includes is undefined", () => {
    const result = mapRepliesToComments(replyTweets);

    expect(result[0].author_handle).toBe("@unknown");
  });

  it("maps content and metrics correctly", () => {
    const result = mapRepliesToComments(replyTweets, { users });

    expect(result[0].content).toBe("Great post!");
    expect(result[0].likes).toBe(5);
    expect(result[0].reply_count).toBe(1);

    expect(result[1].content).toBe("I disagree with this take");
    expect(result[1].likes).toBe(12);
    expect(result[1].reply_count).toBe(3);
  });

  it("defaults metrics to 0 when public_metrics is missing", () => {
    const noMetricsReply: XApiTweet[] = [
      { id: "reply_003", text: "No metrics here", author_id: "user_103" },
    ];

    const result = mapRepliesToComments(noMetricsReply, { users });

    expect(result[0].likes).toBe(0);
    expect(result[0].reply_count).toBe(0);
  });

  it("returns empty array for empty input", () => {
    const result = mapRepliesToComments([]);
    expect(result).toEqual([]);
  });
});
