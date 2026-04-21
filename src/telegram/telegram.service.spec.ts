import { TelegramService, ApprovalPayload } from './telegram.service';

// jest.mock is hoisted — keep factory self-contained, no external references
jest.mock('ioredis', () => {
  const redisMock = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  };
  function MockRedis(_url?: string) {
    return redisMock;
  }
  Object.assign(MockRedis, { default: MockRedis });
  return MockRedis;
});

jest.mock('nestjs-telegraf', () => ({
  InjectBot: () => () => {},
}));

const mockBot = {
  telegram: {
    sendMessage: jest.fn().mockResolvedValue({ message_id: 42 }),
    editMessageReplyMarkup: jest.fn().mockResolvedValue({}),
  },
};

const mockApprovalQueue = {
  getJob: jest.fn(),
  add: jest.fn(),
};

describe('TelegramService', () => {
  let service: TelegramService;

  beforeEach(() => {
    service = new TelegramService(mockBot as any, mockApprovalQueue as any);
    jest.clearAllMocks();
  });

  describe('getMode / setMode', () => {
    it('returns manual when Redis has no key', async () => {
      (service as any).redis.get = jest.fn().mockResolvedValue(null);
      expect(await service.getMode()).toBe('manual');
    });

    it('returns afk when Redis key is afk', async () => {
      (service as any).redis.get = jest.fn().mockResolvedValue('afk');
      expect(await service.getMode()).toBe('afk');
    });

    it('returns manual for any non-afk value', async () => {
      (service as any).redis.get = jest.fn().mockResolvedValue('unknown');
      expect(await service.getMode()).toBe('manual');
    });

    it('setMode writes to Redis', async () => {
      const redisMock = { set: jest.fn() };
      (service as any).redis = redisMock;
      await service.setMode('afk');
      expect(redisMock.set).toHaveBeenCalledWith('bot:mode', 'afk');
    });

    it('setMode writes manual to Redis', async () => {
      const redisMock = { set: jest.fn() };
      (service as any).redis = redisMock;
      await service.setMode('manual');
      expect(redisMock.set).toHaveBeenCalledWith('bot:mode', 'manual');
    });
  });

  describe('cancelTimeoutJob', () => {
    it('removes job when found', async () => {
      const mockJob = { remove: jest.fn() };
      mockApprovalQueue.getJob.mockResolvedValue(mockJob);
      await service.cancelTimeoutJob('c1');
      expect(mockJob.remove).toHaveBeenCalled();
    });

    it('does nothing when job not found', async () => {
      mockApprovalQueue.getJob.mockResolvedValue(null);
      await expect(service.cancelTimeoutJob('c1')).resolves.not.toThrow();
    });

    it('queries with correct jobId prefix', async () => {
      mockApprovalQueue.getJob.mockResolvedValue(null);
      await service.cancelTimeoutJob('abc-123');
      expect(mockApprovalQueue.getJob).toHaveBeenCalledWith('approval-abc-123');
    });
  });

  describe('sendApprovalMessage', () => {
    const basePayload: ApprovalPayload = {
      kolPostId: 'p1',
      kolId: 'k1',
      kolHandle: 'alice',
      postContent: 'post content',
      postUrl: 'https://x.com/k/1',
      summary: 'A post about crypto',
      sentiment: {
        sentiment: 'positive',
        positive_pct: 60,
        neutral_pct: 30,
        negative_pct: 10,
        trend_summary: 'positive vibes',
      },
      candidates: [{ id: 'c1', content: 'great post!', alignment: 'positive' }],
    };

    it('returns the message_id as string', async () => {
      (service as any).adminChatId = '123456';
      const msgId = await service.sendApprovalMessage(basePayload);
      expect(msgId).toBe('42');
    });

    it('sends message to adminChatId with HTML parse mode', async () => {
      (service as any).adminChatId = '123456';
      await service.sendApprovalMessage(basePayload);
      expect(mockBot.telegram.sendMessage).toHaveBeenCalledWith(
        '123456',
        expect.stringContaining('@alice'),
        expect.objectContaining({ parse_mode: 'HTML' }),
      );
    });

    it('includes sentiment data in message text', async () => {
      (service as any).adminChatId = '123456';
      await service.sendApprovalMessage(basePayload);
      const callArgs = mockBot.telegram.sendMessage.mock.calls[0];
      expect(callArgs[1]).toContain('60%');
      expect(callArgs[1]).toContain('positive vibes');
    });

    it('includes inline keyboard with candidate buttons', async () => {
      (service as any).adminChatId = '123456';
      await service.sendApprovalMessage(basePayload);
      const callArgs = mockBot.telegram.sendMessage.mock.calls[0];
      const replyMarkup = callArgs[2].reply_markup;
      expect(replyMarkup.inline_keyboard).toBeDefined();
      // approve button for candidate + reject/regenerate row
      expect(replyMarkup.inline_keyboard.length).toBe(2);
      expect(replyMarkup.inline_keyboard[0][0].callback_data).toBe('approve:c1');
    });

    it('includes reject and regenerate buttons', async () => {
      (service as any).adminChatId = '123456';
      await service.sendApprovalMessage(basePayload);
      const callArgs = mockBot.telegram.sendMessage.mock.calls[0];
      const actionRow = callArgs[2].reply_markup.inline_keyboard[1];
      expect(actionRow[0].callback_data).toBe('reject:p1');
      expect(actionRow[1].callback_data).toBe('regenerate:p1');
    });
  });

  describe('removeApprovalButtons', () => {
    it('calls editMessageReplyMarkup with empty keyboard', async () => {
      (service as any).adminChatId = '999';
      await service.removeApprovalButtons('42');
      expect(mockBot.telegram.editMessageReplyMarkup).toHaveBeenCalledWith(
        '999',
        42,
        undefined,
        { inline_keyboard: [] },
      );
    });

    it('does not throw if editMessageReplyMarkup fails', async () => {
      mockBot.telegram.editMessageReplyMarkup.mockRejectedValueOnce(new Error('already edited'));
      await expect(service.removeApprovalButtons('42')).resolves.not.toThrow();
    });
  });
});
