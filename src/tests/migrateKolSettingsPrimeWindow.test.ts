import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ─────────────────────────────────────────────────────────────

const { mockFindOne, mockUpdateOne } = vi.hoisted(() => ({
  mockFindOne: vi.fn(),
  mockUpdateOne: vi.fn(),
}));

function makeFindOneChain(resolvedValue: unknown) {
  return { lean: vi.fn().mockResolvedValue(resolvedValue) };
}

vi.mock("../db/connection.js", () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  disconnectDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/models/KolSettings.js", () => ({
  KolSettings: {
    findOne: mockFindOne,
    updateOne: mockUpdateOne,
  },
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { runMigrateKolSettingsPrimeWindow } from "../scripts/migrateKolSettingsPrimeWindow.js";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("migrateKolSettingsPrimeWindow (idempotency)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is a no-op when KolSettings doc already has both prime_window and tier_batch_intervals", async () => {
    mockFindOne.mockReturnValue(makeFindOneChain({
      _id: "settings-id",
      prime_window: { start_hour: 9, end_hour: 13 },
      tier_batch_intervals: { A: 120, B: 180, C: 240 },
    }));

    const status = await runMigrateKolSettingsPrimeWindow();

    expect(status).toBe("ok");
    expect(mockFindOne).toHaveBeenCalledTimes(1);
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it("backfills the fields when prime_window is missing", async () => {
    mockFindOne.mockReturnValue(makeFindOneChain({
      _id: "settings-id",
      prime_window: { start_hour: 0, end_hour: 0 }, // not "set" per the script's guard
      tier_batch_intervals: { A: 120, B: 180, C: 240 },
    }));
    mockUpdateOne.mockResolvedValue({ acknowledged: true });

    const status = await runMigrateKolSettingsPrimeWindow();

    expect(status).toBe("ok");
    expect(mockUpdateOne).toHaveBeenCalledTimes(1);
    const updateArg = mockUpdateOne.mock.calls[0]?.[1] as {
      $set: Record<string, number>;
    };
    expect(updateArg.$set["prime_window.start_hour"]).toBe(9);
    expect(updateArg.$set["prime_window.end_hour"]).toBe(13);
    expect(updateArg.$set["tier_batch_intervals.A"]).toBe(120);
  });

  it("returns 'ok' without calling updateOne when no KolSettings doc exists", async () => {
    mockFindOne.mockReturnValue(makeFindOneChain(null));

    const status = await runMigrateKolSettingsPrimeWindow();

    expect(status).toBe("ok");
    expect(mockUpdateOne).not.toHaveBeenCalled();
  });

  it("returns 'error' when findOne throws", async () => {
    mockFindOne.mockReturnValue({ lean: vi.fn().mockRejectedValue(new Error("db down")) });

    const status = await runMigrateKolSettingsPrimeWindow();

    expect(status).toBe("error");
  });
});
