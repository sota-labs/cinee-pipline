import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks (must be before imports) ─────────────────────────────────────

vi.mock("../db/models/KolProfile.js", () => ({
  KolProfile: {
    findOne: vi.fn(),
    updateOne: vi.fn(),
  },
}));

vi.mock("../config/settings.js", () => ({
  settings: { xApiBearerToken: "test-token" },
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { KolProfile } from "../db/models/KolProfile.js";
import {
  getUserIdByHandle,
  getUserTweets,
  XRateLimitError,
  XUserNotFoundError,
} from "../services/platforms/x/xApiClient.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHeaders(overrides: Record<string, string> = {}): Headers {
  const h = new Headers({
    "content-type": "application/json",
    ...overrides,
  });
  return h;
}

function makeResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: makeHeaders(headers),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("getUserIdByHandle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cached x_user_id without calling fetch (cache hit)", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    vi.mocked(KolProfile.findOne).mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue({ x_user_id: "cached_uid_123" }),
      }),
    } as unknown as ReturnType<typeof KolProfile.findOne>);

    const result = await getUserIdByHandle("testuser");

    expect(result).toBe("cached_uid_123");
    expect(mockFetch).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("calls fetch and updates KolProfile on cache miss", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ data: { id: "fetched_uid_456", username: "testuser" } }),
    );
    vi.stubGlobal("fetch", mockFetch);

    vi.mocked(KolProfile.findOne).mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      }),
    } as unknown as ReturnType<typeof KolProfile.findOne>);

    vi.mocked(KolProfile.updateOne).mockResolvedValue({} as never);

    const result = await getUserIdByHandle("testuser");

    expect(result).toBe("fetched_uid_456");
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(KolProfile.updateOne).toHaveBeenCalledWith(
      { handle: "testuser" },
      { x_user_id: "fetched_uid_456" },
    );

    vi.unstubAllGlobals();
  });

  it("strips leading @ from handle before lookup", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ data: { id: "uid_789", username: "atuser" } }),
    );
    vi.stubGlobal("fetch", mockFetch);

    vi.mocked(KolProfile.findOne).mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      }),
    } as unknown as ReturnType<typeof KolProfile.findOne>);

    vi.mocked(KolProfile.updateOne).mockResolvedValue({} as never);

    await getUserIdByHandle("@atuser");

    expect(KolProfile.findOne).toHaveBeenCalledWith({ handle: "atuser" });

    vi.unstubAllGlobals();
  });

  it("throws XUserNotFoundError on 404 response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeResponse({}, 404));
    vi.stubGlobal("fetch", mockFetch);

    vi.mocked(KolProfile.findOne).mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      }),
    } as unknown as ReturnType<typeof KolProfile.findOne>);

    await expect(getUserIdByHandle("ghostuser")).rejects.toThrow(XUserNotFoundError);

    vi.unstubAllGlobals();
  });

  it("throws XRateLimitError with valid retryAfter on 429 response", async () => {
    const resetTimestamp = Math.floor((Date.now() + 15 * 60 * 1000) / 1000);
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({}, 429, {
        "x-ratelimit-reset": String(resetTimestamp),
        "x-ratelimit-remaining": "0",
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    vi.mocked(KolProfile.findOne).mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      }),
    } as unknown as ReturnType<typeof KolProfile.findOne>);

    let caughtError: unknown;
    try {
      await getUserIdByHandle("ratelimiteduser");
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(XRateLimitError);
    const rateLimitErr = caughtError as XRateLimitError;
    expect(rateLimitErr.retryAfter).toBeInstanceOf(Date);
    expect(rateLimitErr.retryAfter.getTime()).toBeCloseTo(resetTimestamp * 1000, -3);

    vi.unstubAllGlobals();
  });
});

describe("getUserTweets — rate limit header tracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws XRateLimitError on 429 response from getUserTweets", async () => {
    const resetTimestamp = Math.floor((Date.now() + 10 * 60 * 1000) / 1000);
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({}, 429, {
        "x-ratelimit-reset": String(resetTimestamp),
        "x-ratelimit-remaining": "0",
      }),
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(getUserTweets("user_001")).rejects.toThrow(XRateLimitError);
  });

  it("returns tweets array on successful response", async () => {
    const tweetData = [
      {
        id: "tweet_001",
        text: "Hello world",
        created_at: "2026-05-29T10:00:00.000Z",
        public_metrics: { like_count: 10, reply_count: 2, retweet_count: 1, impression_count: 500 },
      },
    ];

    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse(
        { data: tweetData, includes: {}, meta: { result_count: 1 } },
        200,
        { "x-ratelimit-remaining": "100", "x-ratelimit-reset": "9999999999" },
      ),
    );
    vi.stubGlobal("fetch", mockFetch);

    // Use a different userId to avoid rate limit state bleed from the 429 test above
    const result = await getUserTweets("user_fresh_no_ratelimit");

    expect(result.tweets).toHaveLength(1);
    expect(result.tweets[0].id).toBe("tweet_001");
    expect(result.includes).toBeDefined();
  });

  it("returns empty tweets array when data is absent", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse({ meta: { result_count: 0 } }, 200),
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await getUserTweets("user_empty_no_ratelimit");

    expect(result.tweets).toEqual([]);
  });
});

describe("XRateLimitError", () => {
  it("has correct name and retryAfter property", () => {
    const retryAfter = new Date(Date.now() + 60_000);
    const err = new XRateLimitError(retryAfter);

    expect(err.name).toBe("XRateLimitError");
    expect(err.retryAfter).toBe(retryAfter);
    expect(err.message).toContain("rate limit");
  });
});

describe("XUserNotFoundError", () => {
  it("has correct name and handle property", () => {
    const err = new XUserNotFoundError("ghostuser");

    expect(err.name).toBe("XUserNotFoundError");
    expect(err.handle).toBe("ghostuser");
    expect(err.message).toContain("ghostuser");
  });
});
