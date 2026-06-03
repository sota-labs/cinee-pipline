import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockProfileFindOne, mockProfileCreate, mockPostFindOne, mockPostFind, mockTaskCreate } =
  vi.hoisted(() => ({
    mockProfileFindOne: vi.fn(),
    mockProfileCreate: vi.fn(),
    mockPostFindOne: vi.fn(),
    mockPostFind: vi.fn(),
    mockTaskCreate: vi.fn(),
  }));

vi.mock("../db/connection.js", () => ({
  connectDb: vi.fn().mockResolvedValue(undefined),
  disconnectDb: vi.fn().mockResolvedValue(undefined),
}));

const mockProfile = {
  _key: "own_account",
  manual_config: {},
  learned_profile: {
    writing_style: "",
    slang_words: [],
    emoji_pattern: "",
    sentence_structure: "",
    engagement_tone: "",
    avg_post_length: 0,
    last_learned_at: null,
    last_learn_trigger_at: null,
    posts_analyzed: 0,
    learning_confidence: 0,
  },
  effective_profile: {},
  save: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../db/models/OwnAccountProfile.js", () => ({
  OwnAccountProfile: {
    findOne: mockProfileFindOne,
    create: mockProfileCreate,
  },
}));

vi.mock("../db/models/Post.js", () => ({
  Post: { findOne: mockPostFindOne, find: mockPostFind },
  EPostStatus: { POSTED: "posted" },
}));

vi.mock("../db/models/Task.js", () => ({
  Task: { create: mockTaskCreate },
  ETaskType: { CRON_JOB_TRIGGER: "cron_job_trigger" },
  ETaskStatus: { PENDING: "pending" },
}));

vi.mock("../config/settings.js", () => ({
  settings: { xUsername: "test_handle", openClawAgent: "test_agent" },
}));

vi.mock("../prompts/ownAccountPrompts.js", () => ({
  buildOwnAccountLearningPrompt: vi.fn().mockReturnValue("mocked prompt"),
}));

import { ownAccountService } from "../services/ownAccountService.js";

describe("ownAccountService.autoLearnPersonality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileFindOne.mockResolvedValue({ ...mockProfile, save: mockProfile.save });
    mockProfileCreate.mockImplementation(() => mockProfile);
    mockProfile.save.mockClear();
  });

  it("returns null and skips when last trigger was < 24h ago", async () => {
    const recent = { ...mockProfile };
    recent.learned_profile.last_learn_trigger_at = new Date(Date.now() - 60 * 60 * 1000);
    mockProfileFindOne.mockResolvedValue(recent);

    const result = await ownAccountService.autoLearnPersonality();
    expect(result).toBeNull();
    expect(mockPostFindOne).not.toHaveBeenCalled();
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it("returns null when no eligible POSTED post exists past 24h", async () => {
    mockProfileFindOne.mockResolvedValue({ ...mockProfile });
    mockPostFindOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });

    const result = await ownAccountService.autoLearnPersonality();
    expect(result).toBeNull();
    expect(mockTaskCreate).not.toHaveBeenCalled();
  });

  it("does not crash when getProfile returns a fresh profile (last_learn_trigger_at is null)", async () => {
    mockProfileFindOne.mockResolvedValue({ ...mockProfile });
    mockPostFindOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(null) }) });

    const result = await ownAccountService.autoLearnPersonality();
    expect(result).toBeNull();
  });
});
