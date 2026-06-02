import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks (must be before imports) ─────────────────────────────────────

vi.mock("../db/models/KolSettings.js", async () => {
  const actual = await vi.importActual<typeof import("../db/models/KolSettings.js")>(
    "../db/models/KolSettings.js",
  );
  return {
    ...actual,
    KolSettings: { getSettings: vi.fn() },
  };
});

vi.mock("../db/models/KolPost.js", async () => {
  const actual = await vi.importActual<typeof import("../db/models/KolPost.js")>(
    "../db/models/KolPost.js",
  );
  return {
    ...actual,
    KolPost: {
      find: vi.fn(),
      findOneAndUpdate: vi.fn(),
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      updateMany: vi.fn(),
    },
  };
});

vi.mock("../db/models/KolProfile.js", () => ({
  KolProfile: { findById: vi.fn() },
}));

vi.mock("../db/models/Task.js", () => ({
  Task: { create: vi.fn() },
  ETaskType: { CRON_JOB_TRIGGER: "cron_job_trigger" },
  ETaskStatus: { PENDING: "pending" },
}));

vi.mock("../config/settings.js", () => ({
  settings: { openClawAgent: "main", openClawAnalysisModel: "sonnet" },
}));

vi.mock("../utils/agentCommand.js", () => ({
  buildAgentCommand: vi.fn(() => "agent --agent main --message 'x'"),
  generateTaskId: vi.fn(() => "task-1"),
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { KolSettings } from "../db/models/KolSettings.js";
import { KolPost, EKolPostStatus } from "../db/models/KolPost.js";
import { KolProfile } from "../db/models/KolProfile.js";
import { Task } from "../db/models/Task.js";
import { kolAnalyzerService } from "../services/kolAnalyzerService.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockSettings(stuckThresholdMinutes = 15) {
  vi.mocked(KolSettings.getSettings).mockResolvedValue({
    analyze_batch_size: 10,
    analyze_stuck_threshold_minutes: stuckThresholdMinutes,
  } as never);
}

// ── sweepStuckAnalyzingPosts ─────────────────────────────────────────────────

describe("kolAnalyzerService.sweepStuckAnalyzingPosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets ANALYZING posts older than the threshold back to NEW", async () => {
    mockSettings(15);
    vi.mocked(KolPost.updateMany).mockResolvedValue({ modifiedCount: 3, matchedCount: 3 } as never);

    const swept = await kolAnalyzerService.sweepStuckAnalyzingPosts();

    expect(swept).toBe(3);
    expect(KolPost.updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = vi.mocked(KolPost.updateMany).mock.calls[0] as [unknown, unknown];
    expect(filter).toMatchObject({ status: EKolPostStatus.ANALYZING });
    expect((filter as { analyze_started_at: { $lte: Date } }).analyze_started_at.$lte).toBeInstanceOf(Date);
    expect(update).toEqual({ $set: { status: EKolPostStatus.NEW, analyze_started_at: null } });
  });

  it("uses a cutoff derived from the configured threshold", async () => {
    mockSettings(30);
    vi.mocked(KolPost.updateMany).mockResolvedValue({ modifiedCount: 0 } as never);

    const before = Date.now();
    await kolAnalyzerService.sweepStuckAnalyzingPosts();
    const after = Date.now();

    const cutoff = (
      vi.mocked(KolPost.updateMany).mock.calls[0][0] as unknown as { analyze_started_at: { $lte: Date } }
    ).analyze_started_at.$lte.getTime();

    // cutoff should be ~30 minutes before now
    expect(cutoff).toBeGreaterThanOrEqual(before - 30 * 60_000 - 50);
    expect(cutoff).toBeLessThanOrEqual(after - 30 * 60_000 + 50);
  });

  it("returns 0 when nothing is stuck", async () => {
    mockSettings();
    vi.mocked(KolPost.updateMany).mockResolvedValue({ modifiedCount: 0 } as never);

    const swept = await kolAnalyzerService.sweepStuckAnalyzingPosts();
    expect(swept).toBe(0);
  });
});

// ── analyzePendingPosts ──────────────────────────────────────────────────────

describe("kolAnalyzerService.analyzePendingPosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sweeps stuck posts before picking up NEW ones", async () => {
    mockSettings();
    vi.mocked(KolPost.updateMany).mockResolvedValue({ modifiedCount: 1 } as never);
    vi.mocked(KolPost.find).mockReturnValue({ sort: () => ({ limit: () => [] }) } as never);

    const result = await kolAnalyzerService.analyzePendingPosts();

    expect(result.swept).toBe(1);
    expect(KolPost.updateMany).toHaveBeenCalledTimes(1);
    expect(KolPost.find).toHaveBeenCalledTimes(1);
  });

  it("queues analysis for pending posts after sweep", async () => {
    mockSettings();
    vi.mocked(KolPost.updateMany).mockResolvedValue({ modifiedCount: 0 } as never);

    const fakePost = {
      _id: "p1",
      kol_id: "k1",
      content: "hello world",
      likes: 10,
      comments: 5,
      retweets: 2,
      views: 100,
      top_comments: [],
    };
    vi.mocked(KolPost.find).mockReturnValue({
      sort: () => ({ limit: () => [fakePost] }),
    } as never);
    vi.mocked(KolProfile.findById).mockReturnValue({
      select: () => ({ lean: () => ({ tier: "S", handle: "kol1" }) }),
    } as never);
    vi.mocked(KolPost.findOneAndUpdate).mockResolvedValue(fakePost as never);
    vi.mocked(Task.create).mockResolvedValue({} as never);

    const result = await kolAnalyzerService.analyzePendingPosts();

    expect(result.queued).toBe(1);
    expect(result.errors).toBe(0);
    expect(Task.create).toHaveBeenCalledTimes(1);
  });
});
