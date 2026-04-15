import { describe, it, expect } from "vitest";
import { ETaskStatus, ETaskType } from "../db/models/Task.js";
import {
  ECurationStatus,
  ECurationMediaType,
} from "../db/models/CurationSource.js";

describe("ETaskStatus", () => {
  it("has all four expected values", () => {
    expect(ETaskStatus.PENDING).toBe("pending");
    expect(ETaskStatus.PROCESSING).toBe("processing");
    expect(ETaskStatus.COMPLETED).toBe("completed");
    expect(ETaskStatus.FAILED).toBe("failed");
  });

  it("contains exactly 4 entries", () => {
    expect(Object.values(ETaskStatus)).toHaveLength(4);
  });
});

describe("ETaskType", () => {
  it("has all expected task types", () => {
    expect(ETaskType.POST_NOW).toBe("post_now");
    expect(ETaskType.AI_REWRITE).toBe("ai_rewrite");
    expect(ETaskType.SCAN_AND_POST).toBe("scan_and_post");
    expect(ETaskType.CRON_JOB).toBe("run_agent");
  });

  it("contains exactly 4 entries", () => {
    expect(Object.values(ETaskType)).toHaveLength(4);
  });
});

describe("ECurationStatus", () => {
  it("has all expected curation statuses", () => {
    expect(ECurationStatus.NEW).toBe("new");
    expect(ECurationStatus.SELECTED).toBe("selected");
    expect(ECurationStatus.USED).toBe("used");
  });

  it("contains exactly 3 entries", () => {
    expect(Object.values(ECurationStatus)).toHaveLength(3);
  });
});

describe("ECurationMediaType", () => {
  it("has all expected media types", () => {
    expect(ECurationMediaType.VIDEO).toBe("video");
    expect(ECurationMediaType.IMAGE).toBe("image");
    expect(ECurationMediaType.GIF).toBe("gif");
    expect(ECurationMediaType.NONE).toBe("none");
  });

  it("contains exactly 4 entries", () => {
    expect(Object.values(ECurationMediaType)).toHaveLength(4);
  });
});
