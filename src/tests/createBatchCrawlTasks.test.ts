import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ─────────────────────────────────────────────────────────────

const { mockFind, mockCreate } = vi.hoisted(() => ({
  mockFind: vi.fn(),
  mockCreate: vi.fn(),
}));

vi.mock("../db/models/KolSettings.js", () => ({
  KolSettings: { getSettings: vi.fn() },
}));

vi.mock("../db/models/KolProfile.js", () => ({
  KolProfile: { find: mockFind },
}));

/**
 * Replace the default KolProfile.find mock with a chainable query whose
 * `.limit(n)` resolves to the supplied KOLs. Usage:
 *   chainFindWith([kol1, kol2]);
 *   // KolProfile.find(...).limit(...) now returns [kol1, kol2]
 */
function chainFindWith(kols: unknown[]) {
  mockFind.mockImplementation(() => ({
    limit: vi.fn().mockReturnValue(kols),
  }));
}

vi.mock("../db/models/Task.js", () => ({
  Task: { create: mockCreate },
  ETaskType: { SINGLE_TASK_TRIGGER: "single_task_trigger" },
  ETaskStatus: { PENDING: "pending" },
}));

vi.mock("../config/settings.js", () => ({
  settings: { openClawAgent: "main" },
}));

// Silence pLimit (its constructor returns a function); we just need tasks to all fire.
vi.mock("p-limit", () => ({
  default: () => <T>(fn: () => Promise<T>) => fn(),
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { KolSettings } from "../db/models/KolSettings.js";
import { KolProfile } from "../db/models/KolProfile.js";
import { createBatchCrawlTasks } from "../services/kolCrawlerService.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fakeKol(handle: string, tier: "S" | "A" | "B" | "C", lastCrawledAt: Date | null = null) {
  return { _id: handle, handle, tier, last_crawled_at: lastCrawledAt };
}

const baseSettings = {
  prime_window: { start_hour: 9, end_hour: 13 },
  tier_batch_intervals: { A: 120, B: 180, C: 240 },
  tier_crawl_intervals: { S: 15, A: 240, B: 240, C: 480 },
  safety: { min_kol_trust_score: 30 },
  crawl_concurrency: 5,
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("createBatchCrawlTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(KolSettings.getSettings).mockResolvedValue(baseSettings as never);
  });

  it("enqueues a Task for every KOL returned by KolProfile.find", async () => {
    const kols = [fakeKol("a", "A"), fakeKol("b", "A"), fakeKol("c", "A")];
    chainFindWith(kols);
    mockCreate.mockResolvedValue({ _id: "task-id" });

    const result = await createBatchCrawlTasks(["A"]);

    expect(result.tasksCreated).toBe(3);
    expect(result.handles).toEqual(["a", "b", "c"]);
    expect(result.skipped).toEqual([]);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it("survives a single Task.create failure: that KOL is skipped, the rest still created", async () => {
    const kols = [fakeKol("a", "A"), fakeKol("b", "A"), fakeKol("c", "A")];
    chainFindWith(kols);
    mockCreate.mockImplementation(async (doc: { handle_group?: string }) => {
      if (doc.handle_group === "b") throw new Error("simulated DB error");
      return { _id: `task-${doc.handle_group}` };
    });

    const result = await createBatchCrawlTasks(["A"]);

    expect(result.tasksCreated).toBe(2);
    expect(result.handles).toEqual(["a", "c"]);
    expect(result.skipped).toEqual(["b"]);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it("forceAll: true ignores last_crawled_at cutoff and enqueues every active KOL in the tiers", async () => {
    // All KOLs were just crawled (now). With forceAll: false they'd be filtered out.
    const justNow = new Date();
    const kols = [fakeKol("a", "A", justNow), fakeKol("b", "A", justNow)];
    chainFindWith(kols);
    mockCreate.mockResolvedValue({ _id: "task-id" });

    const result = await createBatchCrawlTasks(["A"], { forceAll: true });

    expect(result.tasksCreated).toBe(2);
    expect(result.handles).toEqual(["a", "b"]);

    // The query passed to find must NOT include the $or last_crawled_at cutoff.
    const queryArg = vi.mocked(KolProfile.find).mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(queryArg).toBeDefined();
    expect(queryArg).not.toHaveProperty("$or");
  });

  it("without forceAll, the $or last_crawled_at cutoff IS included in the find query", async () => {
    chainFindWith([]);
    await createBatchCrawlTasks(["A"]);

    const queryArg = vi.mocked(KolProfile.find).mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(queryArg).toBeDefined();
    expect(queryArg).toHaveProperty("$or");
  });

  it("returns an empty result when no KOLs are due", async () => {
    chainFindWith([]);
    const result = await createBatchCrawlTasks(["A", "B"]);
    expect(result.tasksCreated).toBe(0);
    expect(result.handles).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns an empty result when tiers is empty (short-circuit)", async () => {
    const result = await createBatchCrawlTasks([]);
    expect(result).toEqual({ tasksCreated: 0, handles: [], skipped: [] });
    expect(vi.mocked(KolProfile.find)).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("propagates handle_group and payload.action='batch_crawl' onto the created Task", async () => {
    chainFindWith([fakeKol("alice", "A")]);
    mockCreate.mockResolvedValue({ _id: "task-id" });

    await createBatchCrawlTasks(["A"]);

    const created = mockCreate.mock.calls[0]?.[0] as {
      handle_group: string;
      payload: { action: string; handles: string[] };
    };
    expect(created.handle_group).toBe("alice");
    expect(created.payload.action).toBe("batch_crawl");
    expect(created.payload.handles).toEqual(["alice"]);
  });
});
