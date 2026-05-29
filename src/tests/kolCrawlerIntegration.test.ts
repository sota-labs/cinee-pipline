import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks (must be before imports) ─────────────────────────────────────

vi.mock("../services/platforms/x/xApiClient.js", () => ({
  getUserIdByHandle: vi.fn(),
  getUserTweets: vi.fn(),
  getTweetReplies: vi.fn(),
  XRateLimitError: class XRateLimitError extends Error {
    retryAfter: Date;
    constructor(retryAfter: Date) {
      super(`X API rate limit exceeded. Retry after ${retryAfter.toISOString()}`);
      this.name = "XRateLimitError";
      this.retryAfter = retryAfter;
    }
  },
  XUserNotFoundError: class XUserNotFoundError extends Error {
    handle: string;
    constructor(handle: string) {
      super(`X user not found: @${handle}`);
      this.name = "XUserNotFoundError";
      this.handle = handle;
    }
  },
}));

vi.mock("../db/models/KolProfile.js", () => ({
  KolProfile: {
    find: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
    countDocuments: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock("../db/models/KolPost.js", () => ({
  KolPost: {
    find: vi.fn(),
    findOne: vi.fn(),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    create: vi.fn(),
  },
  EKolPostStatus: { NEW: "new", ANALYZING: "analyzing", ANALYZED: "analyzed" },
}));

vi.mock("../db/models/KolSettings.js", () => ({
  KolSettings: {
    getSettings: vi.fn(),
  },
}));

vi.mock("../db/redis.js", () => ({
  getRedis: () => ({
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue("OK"),
  }),
}));

vi.mock("../config/settings.js", () => ({
  settings: { xApiBearerToken: "test-token", openClawAgent: "main" },
}));

vi.mock("../db/models/Task.js", () => ({
  Task: { find: vi.fn() },
  ETaskType: { CRON_JOB_TRIGGER: "cron_job_trigger" },
  ETaskStatus: { PENDING: "pending", PROCESSING: "processing" },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { KolPost } from "../db/models/KolPost.js";
import { KolSettings } from "../db/models/KolSettings.js";
import {
  getUserIdByHandle,
  getUserTweets,
  getTweetReplies,
  XRateLimitError,
  XUserNotFoundError,
} from "../services/platforms/x/xApiClient.js";
import { KolCrawlerService, processCrawlResults } from "../services/kolCrawlerService.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeKolProfile(overrides: Record<string, unknown> = {}) {
  return {
    _id: "kol_id_001",
    handle: "cryptokol",
    is_active: true,
    reputation_score: 80,
    tier: "A",
    last_crawled_at: null,
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeTweet(id: string, text: string, createdAt?: string) {
  return {
    id,
    text,
    created_at: createdAt ?? new Date().toISOString(),
    author_id: "user_001",
    public_metrics: {
      like_count: 10,
      reply_count: 2,
      retweet_count: 3,
      impression_count: 500,
    },
  };
}

const defaultSettings = {
  max_posts_per_crawl: 10,
  safety: { min_kol_trust_score: 30 },
  tier_crawl_intervals: { S: 30, A: 120, B: 240, C: 480 },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("KolCrawlerService.crawlKol", () => {
  let service: KolCrawlerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new KolCrawlerService();

    vi.mocked(KolSettings.getSettings).mockResolvedValue(defaultSettings as never);

    // KolPost.findOne for sinceId lookup — no latest post
    vi.mocked(KolPost.findOne).mockReturnValue({
      sort: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue(null),
        }),
      }),
    } as unknown as ReturnType<typeof KolPost.findOne>);
  });

  describe("happy path", () => {
    it("fetches tweets, maps them to IRawPost, calls processCrawlResults, updates last_crawled_at", async () => {
      const kol = makeKolProfile();
      const tweet1 = makeTweet("tweet_001", "This is a great crypto insight worth reading");
      const tweet2 = makeTweet("tweet_002", "Another solid take on the market conditions today");

      vi.mocked(getUserIdByHandle).mockResolvedValue("x_user_001");
      vi.mocked(getUserTweets).mockResolvedValue({
        tweets: [tweet1, tweet2],
        includes: {},
      });
      vi.mocked(getTweetReplies).mockResolvedValue({ tweets: [], includes: {} });

      // processCrawlResults calls KolPost.findOne (duplicate check) and KolPost.create
      vi.mocked(KolPost.findOne)
        .mockReturnValueOnce({
          sort: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              lean: vi.fn().mockResolvedValue(null),
            }),
          }),
        } as unknown as ReturnType<typeof KolPost.findOne>)
        // duplicate check for tweet_001
        .mockResolvedValueOnce(null as never)
        // duplicate check for tweet_002
        .mockResolvedValueOnce(null as never);

      vi.mocked(KolPost.create).mockResolvedValue({
        _id: "post_id_001",
        post_url: `https://x.com/cryptokol/status/tweet_001`,
        comments: 2,
      } as never);

      const result = await service.crawlKol(kol as never);

      expect(getUserIdByHandle).toHaveBeenCalledWith("cryptokol");
      expect(getUserTweets).toHaveBeenCalledWith("x_user_001", undefined);
      expect(result.handle).toBe("cryptokol");
      expect(result.postsFound).toBe(2);
      expect(result.errors).toEqual([]);
      expect(kol.save).toHaveBeenCalled();
      expect(kol.last_crawled_at).toBeInstanceOf(Date);
    });
  });

  describe("XRateLimitError handling", () => {
    it("returns result with errors[] and does NOT call processCrawlResults", async () => {
      const kol = makeKolProfile();
      const retryAfter = new Date(Date.now() + 15 * 60 * 1000);

      vi.mocked(getUserIdByHandle).mockResolvedValue("x_user_001");
      vi.mocked(getUserTweets).mockRejectedValue(new (XRateLimitError as unknown as new (d: Date) => Error)(retryAfter));

      const result = await service.crawlKol(kol as never);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("rate limit");
      expect(result.postsFound).toBe(0);
      expect(result.postsSaved).toBe(0);
      // processCrawlResults would call KolPost.create — verify it was NOT called
      expect(KolPost.create).not.toHaveBeenCalled();
      // last_crawled_at should NOT be updated on rate limit
      expect(kol.save).not.toHaveBeenCalled();
    });
  });

  describe("XUserNotFoundError handling", () => {
    it("sets kol.is_active = false and calls kol.save()", async () => {
      const kol = makeKolProfile({ is_active: true });

      vi.mocked(getUserIdByHandle).mockRejectedValue(
        new (XUserNotFoundError as unknown as new (h: string) => Error)("cryptokol"),
      );

      const result = await service.crawlKol(kol as never);

      expect(kol.is_active).toBe(false);
      expect(kol.save).toHaveBeenCalled();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("cryptokol");
      expect(result.postsFound).toBe(0);
    });
  });
});

describe("processCrawlResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves new posts and returns correct counts", async () => {
    const rawPosts = [
      {
        post_url: "https://x.com/kol/status/111",
        content: "This is a valid post with enough content to pass the filter",
        posted_at: new Date().toISOString(),
        likes: 50,
        comments: 5,
        retweets: 10,
        views: 1000,
        is_retweet: false,
        is_quote: false,
      },
    ];

    vi.mocked(KolPost.findOne).mockResolvedValue(null as never);
    vi.mocked(KolPost.create).mockResolvedValue({
      _id: "post_001",
      post_url: rawPosts[0].post_url,
      comments: 5,
    } as never);

    const result = await processCrawlResults("kol_id_001", rawPosts);

    expect(result.saved).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.dropped).toBe(0);
    expect(KolPost.create).toHaveBeenCalledOnce();
  });

  it("drops retweets", async () => {
    const rawPosts = [
      {
        post_url: "https://x.com/kol/status/222",
        content: "RT @someone: original content here",
        posted_at: new Date().toISOString(),
        likes: 5,
        comments: 1,
        retweets: 100,
        views: 500,
        is_retweet: true,
        is_quote: false,
      },
    ];

    const result = await processCrawlResults("kol_id_001", rawPosts);

    expect(result.dropped).toBe(1);
    expect(result.saved).toBe(0);
    expect(KolPost.create).not.toHaveBeenCalled();
  });

  it("skips duplicate posts (already in DB)", async () => {
    const rawPosts = [
      {
        post_url: "https://x.com/kol/status/333",
        content: "This post already exists in the database",
        posted_at: new Date().toISOString(),
        likes: 20,
        comments: 3,
        retweets: 5,
        views: 300,
        is_retweet: false,
        is_quote: false,
      },
    ];

    vi.mocked(KolPost.findOne).mockResolvedValue({ _id: "existing_post" } as never);

    const result = await processCrawlResults("kol_id_001", rawPosts);

    expect(result.skipped).toBe(1);
    expect(result.saved).toBe(0);
    expect(KolPost.create).not.toHaveBeenCalled();
  });

  it("drops posts with content shorter than 15 chars", async () => {
    const rawPosts = [
      {
        post_url: "https://x.com/kol/status/444",
        content: "Too short",
        posted_at: new Date().toISOString(),
        likes: 5,
        comments: 1,
        retweets: 0,
        views: 50,
        is_retweet: false,
        is_quote: false,
      },
    ];

    const result = await processCrawlResults("kol_id_001", rawPosts);

    expect(result.dropped).toBe(1);
    expect(KolPost.create).not.toHaveBeenCalled();
  });
});
