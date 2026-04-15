import { describe, it, expect } from "vitest";
import { ETaskStatus, ETaskType } from "../db/models/Task.js";
import {
  ECurationStatus,
  ECurationMediaType,
} from "../db/models/CurationSource.js";

describe("ETaskType", () => {
  it("has all expected task types", () => {
    expect(ETaskType.POST_NOW).toBe("post_now");
    expect(ETaskType.AI_REWRITE).toBe("ai_rewrite");
    expect(ETaskType.SCAN_AND_POST).toBe("scan_and_post");
    expect(ETaskType.CRON_JOB_ADD).toBe("cron_job_add");
    expect(ETaskType.CRON_JOB_REMOVE).toBe("cron_job_remove");
    expect(ETaskType.CRON_JOB_TRIGGER).toBe("cron_job_trigger");
  });

  it("contains exactly 4 entries", () => {
    expect(Object.values(ETaskType)).toHaveLength(6);
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
