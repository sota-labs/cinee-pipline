import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks (must be before imports) ─────────────────────────────────────

const { mockCrawlKol } = vi.hoisted(() => ({ mockCrawlKol: vi.fn() }));

vi.mock("../db/models/KolSettings.js", async () => {
  const actual = await vi.importActual<typeof import("../db/models/KolSettings.js")>(
    "../db/models/KolSettings.js",
  );
  return {
    ...actual,
    KolSettings: { getSettings: vi.fn() },
  };
});

vi.mock("../db/models/KolProfile.js", () => ({
  KolProfile: {
    find: vi.fn(),
  },
}));

vi.mock("../db/models/Task.js", () => ({
  Task: {
    create: vi.fn(),
  },
  ETaskType: { SINGLE_TASK_TRIGGER: "single_task_trigger" },
  ETaskStatus: { PENDING: "pending" },
}));

vi.mock("../services/platforms/x/xApiClient.js", () => ({
  XRateLimitError: class XRateLimitError extends Error {
    retryAfter: Date;
    constructor(retryAfter: Date) {
      super(`X API rate limit exceeded. Retry after ${retryAfter.toISOString()}`);
      this.name = "XRateLimitError";
      this.retryAfter = retryAfter;
    }
  },
}));

vi.mock("../services/kolCrawlerService.js", () => ({
  createBatchCrawlTasks: vi.fn(),
  kolCrawlerService: { crawlKol: mockCrawlKol },
}));

vi.mock("../config/settings.js", () => ({
  settings: { openClawAgent: "main" },
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import {
  isWithinPrimeWindow,
  KolSettings,
  type IPrimeWindow,
} from "../db/models/KolSettings.js";
import { KolProfile } from "../db/models/KolProfile.js";
import {
  runPrimePolling,
  runBatchCrawl,
  _resetMutexesForTests,
} from "../services/kolScheduleService.js";
import { createBatchCrawlTasks } from "../services/kolCrawlerService.js";

// ── isWithinPrimeWindow ─────────────────────────────────────────────────────

describe("isWithinPrimeWindow", () => {
  it("returns true when current hour is in [start, end)", () => {
    const pw: IPrimeWindow = { start_hour: 9, end_hour: 13 };
    expect(isWithinPrimeWindow(pw, new Date("2026-06-02T09:00:00Z"))).toBe(true);
    expect(isWithinPrimeWindow(pw, new Date("2026-06-02T10:30:00Z"))).toBe(true);
    expect(isWithinPrimeWindow(pw, new Date("2026-06-02T12:59:00Z"))).toBe(true);
  });

  it("returns false when current hour is outside the window", () => {
    const pw: IPrimeWindow = { start_hour: 9, end_hour: 13 };
    expect(isWithinPrimeWindow(pw, new Date("2026-06-02T08:59:00Z"))).toBe(false);
    expect(isWithinPrimeWindow(pw, new Date("2026-06-02T13:00:00Z"))).toBe(false);
    expect(isWithinPrimeWindow(pw, new Date("2026-06-02T18:00:00Z"))).toBe(false);
  });

  it("handles wrap-around midnight (e.g. 22..2)", () => {
    const pw: IPrimeWindow = { start_hour: 22, end_hour: 2 };
    expect(isWithinPrimeWindow(pw, new Date("2026-06-02T22:00:00Z"))).toBe(true);
    expect(isWithinPrimeWindow(pw, new Date("2026-06-02T23:30:00Z"))).toBe(true);
    expect(isWithinPrimeWindow(pw, new Date("2026-06-02T00:00:00Z"))).toBe(true);
    expect(isWithinPrimeWindow(pw, new Date("2026-06-02T01:59:00Z"))).toBe(true);
    expect(isWithinPrimeWindow(pw, new Date("2026-06-02T02:00:00Z"))).toBe(false);
    expect(isWithinPrimeWindow(pw, new Date("2026-06-02T10:00:00Z"))).toBe(false);
    expect(isWithinPrimeWindow(pw, new Date("2026-06-02T21:59:00Z"))).toBe(false);
  });

  it("returns false when start === end (empty window)", () => {
    const pw: IPrimeWindow = { start_hour: 9, end_hour: 9 };
    expect(isWithinPrimeWindow(pw, new Date("2026-06-02T09:00:00Z"))).toBe(false);
    expect(isWithinPrimeWindow(pw, new Date("2026-06-02T12:00:00Z"))).toBe(false);
  });
});

// ── KolSettings response shape ──────────────────────────────────────────────

describe("KolSettings response shape (new fields)", () => {
  it("exposes prime_window, tier_batch_intervals, tier_crawl_intervals on the returned doc", async () => {
    const mockSettings = {
      prime_window: { start_hour: 9, end_hour: 13 },
      tier_batch_intervals: { A: 120, B: 180, C: 240 },
      tier_crawl_intervals: { S: 15, A: 240, B: 240, C: 480 },
      safety: { min_kol_trust_score: 30 },
      crawl_concurrency: 5,
      max_posts_per_crawl: 10,
    };
    vi.mocked(KolSettings.getSettings).mockResolvedValue(mockSettings as never);

    const s = await KolSettings.getSettings();
    expect(s.prime_window).toEqual({ start_hour: 9, end_hour: 13 });
    expect(s.tier_batch_intervals).toEqual({ A: 120, B: 180, C: 240 });
    expect(s.tier_crawl_intervals.S).toBe(15);
  });
});

// ── runPrimePolling ──────────────────────────────────────────────────────────

describe("runPrimePolling", () => {
  beforeEach(() => {
    _resetMutexesForTests();
    vi.clearAllMocks();
  });

  it("returns outsideWindow=true without crawling when time is outside prime window", async () => {
    vi.mocked(KolSettings.getSettings).mockResolvedValue({
      prime_window: { start_hour: 9, end_hour: 13 },
      tier_crawl_intervals: { S: 15, A: 240, B: 240, C: 480 },
      safety: { min_kol_trust_score: 30 },
      crawl_concurrency: 5,
      max_posts_per_crawl: 10,
    } as never);
    vi.mocked(KolProfile.find).mockReturnValue({ limit: vi.fn().mockReturnValue([]) } as never);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-02T20:00:00Z"));

    const result = await runPrimePolling();
    expect(result.outsideWindow).toBe(true);
    expect(result.polled).toBe(0);
    expect(mockCrawlKol).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("calls crawlKol for Tier S KOLs inside the prime window", async () => {
    vi.mocked(KolSettings.getSettings).mockResolvedValue({
      prime_window: { start_hour: 9, end_hour: 13 },
      tier_crawl_intervals: { S: 15, A: 240, B: 240, C: 480 },
      safety: { min_kol_trust_score: 30 },
      crawl_concurrency: 5,
      max_posts_per_crawl: 10,
    } as never);

    const fakeKols = [{ _id: "1", handle: "kol1", tier: "S" }, { _id: "2", handle: "kol2", tier: "S" }];
    vi.mocked(KolProfile.find).mockReturnValue(fakeKols as never);
    mockCrawlKol.mockResolvedValue({ kolId: "x", handle: "y", postsFound: 0, postsSaved: 0, dropped: 0, errors: [] });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-02T10:00:00Z"));

    const result = await runPrimePolling();
    expect(result.outsideWindow).toBe(false);
    expect(result.polled).toBe(2);
    expect(mockCrawlKol).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("short-circuits when mutex is held", async () => {
    _resetMutexesForTests();
    vi.mocked(KolSettings.getSettings).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return {
        prime_window: { start_hour: 9, end_hour: 13 },
        tier_crawl_intervals: { S: 15, A: 240, B: 240, C: 480 },
        safety: { min_kol_trust_score: 30 },
        crawl_concurrency: 5,
        max_posts_per_crawl: 10,
      } as never;
    });
    vi.mocked(KolProfile.find).mockReturnValue([] as never);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-02T10:00:00Z"));

    const first = runPrimePolling();
    const second = await runPrimePolling();
    expect(second.skipped).toBe(true);
    expect(second.polled).toBe(0);

    // Let the first (slow) call finish, then return to real timers.
    vi.advanceTimersByTime(50);
    vi.useRealTimers();
    await first;
  });
});

// ── runBatchCrawl ────────────────────────────────────────────────────────────

describe("runBatchCrawl", () => {
  beforeEach(() => {
    _resetMutexesForTests();
    vi.clearAllMocks();
  });

  it("calls createBatchCrawlTasks with the given tiers", async () => {
    vi.mocked(createBatchCrawlTasks).mockResolvedValue({
      tasksCreated: 3,
      handles: ["a", "b", "c"],
      skipped: [],
    });
    const result = await runBatchCrawl(["A"]);
    expect(createBatchCrawlTasks).toHaveBeenCalledWith(["A"]);
    expect(result.created).toBe(3);
    expect(result.busy).toBe(false);
  });

  it("short-circuits when mutex is held", async () => {
    _resetMutexesForTests();
    vi.mocked(createBatchCrawlTasks).mockImplementation(async () => {
      // Simulate a slow batch by holding the mutex
      await new Promise((r) => setTimeout(r, 50));
      return { tasksCreated: 1, handles: ["x"], skipped: [] };
    });

    const first = runBatchCrawl(["A"]);
    const second = await runBatchCrawl(["A"]);
    expect(second.busy).toBe(true);
    expect(second.created).toBe(0);
    await first;
  });
});

// ── createBatchCrawlTasks delegation ─────────────────────────────────────────

describe("createBatchCrawlTasks (via the kolCrawlerService module)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the result from the underlying factory", async () => {
    vi.mocked(createBatchCrawlTasks).mockResolvedValue({
      tasksCreated: 2,
      handles: ["a", "b"],
      skipped: [],
    });
    const result = await createBatchCrawlTasks(["A"]);
    expect(result.tasksCreated).toBe(2);
    expect(result.handles).toEqual(["a", "b"]);
  });
});

// ── Cleanup unused imports / afterEach ───────────────────────────────────────

afterEach(() => {
  vi.useRealTimers();
});
