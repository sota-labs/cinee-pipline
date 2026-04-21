import { Test } from '@nestjs/testing';
import { AiProcessingProcessor } from './ai-processing.processor';
import { AiProcessingService } from './ai-processing.service';
import { PrismaService } from '../prisma/prisma.service';
import { getQueueToken } from '@nestjs/bull';
import { BULL_QUEUES } from '../common/constants/kol.constants';

// jest.mock is hoisted — keep factory self-contained, no external references
jest.mock('ioredis', () => {
  const redisMock = {
    get: jest.fn().mockResolvedValue(null),
  };
  function MockRedis(_url?: string) {
    return redisMock;
  }
  Object.assign(MockRedis, { default: MockRedis });
  return MockRedis;
});

const mockPrisma = {
  kolPost: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  kol: { findUnique: jest.fn() },
  kolPostProcessing: {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn(),
  },
  pendingComment: {
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockAiService = {
  runPipeline: jest.fn(),
  selectAfkCandidate: jest.fn(),
};

const mockTelegramQueue = { add: jest.fn().mockResolvedValue({ id: 't1' }) };
const mockEngagementQueue = { add: jest.fn().mockResolvedValue({ id: 'e1' }) };

describe('AiProcessingProcessor', () => {
  let processor: AiProcessingProcessor;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AiProcessingProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiProcessingService, useValue: mockAiService },
        { provide: getQueueToken(BULL_QUEUES.TELEGRAM_APPROVAL), useValue: mockTelegramQueue },
        { provide: getQueueToken(BULL_QUEUES.ENGAGEMENT), useValue: mockEngagementQueue },
      ],
    }).compile();

    processor = module.get(AiProcessingProcessor);
    jest.clearAllMocks();
  });

  it('routes to telegram queue in manual mode', async () => {
    // Override redis.get on the processor instance after construction
    (processor as any).redis = { get: jest.fn().mockResolvedValue('manual') };

    mockPrisma.kolPost.findUnique.mockResolvedValue({
      id: 'p1',
      content: 'post',
      postUrl: 'https://x.com/k/1',
      kolId: 'k1',
      status: 'NEW',
    });
    mockPrisma.kol.findUnique.mockResolvedValue({
      id: 'k1',
      handle: 'alice',
      styleSummary: '',
      personalityNotes: '',
      slangVocab: [],
    });
    mockPrisma.kolPost.update.mockResolvedValue({});
    mockPrisma.kolPostProcessing.upsert.mockResolvedValue({});
    mockPrisma.pendingComment.create
      .mockResolvedValueOnce({ id: 'c1', content: 'ok', alignment: 'positive' })
      .mockResolvedValueOnce({ id: 'c2', content: 'hmm', alignment: 'neutral' })
      .mockResolvedValueOnce({ id: 'c3', content: 'nope', alignment: 'negative' });

    mockAiService.runPipeline.mockResolvedValue({
      summary: 'A post',
      sentiment: {
        sentiment: 'positive',
        positive_pct: 60,
        neutral_pct: 30,
        negative_pct: 10,
        trend_summary: 'mostly positive',
      },
      candidates: [
        { content: 'ok', alignment: 'positive', rationale: '' },
        { content: 'hmm', alignment: 'neutral', rationale: '' },
        { content: 'nope', alignment: 'negative', rationale: '' },
      ],
    });

    await processor.handleProcessPost({ data: { kolPostId: 'p1', kolId: 'k1' } } as any);

    expect(mockTelegramQueue.add).toHaveBeenCalledWith(
      'send-approval',
      expect.objectContaining({ kolHandle: 'alice' }),
      expect.any(Object),
    );
    expect(mockEngagementQueue.add).not.toHaveBeenCalled();
  });

  it('routes to engagement queue in afk mode with correct alignment', async () => {
    (processor as any).redis = { get: jest.fn().mockResolvedValue('afk') };

    mockPrisma.kolPost.findUnique.mockResolvedValue({
      id: 'p1',
      content: 'post',
      postUrl: 'https://x.com/k/1',
      kolId: 'k1',
      status: 'NEW',
    });
    mockPrisma.kol.findUnique.mockResolvedValue({
      id: 'k1',
      handle: 'alice',
      styleSummary: '',
      personalityNotes: '',
      slangVocab: [],
    });
    mockPrisma.kolPost.update.mockResolvedValue({});
    mockPrisma.kolPostProcessing.upsert.mockResolvedValue({});
    mockPrisma.pendingComment.create
      .mockResolvedValueOnce({ id: 'c1', content: 'ok', alignment: 'positive' })
      .mockResolvedValueOnce({ id: 'c2', content: 'hmm', alignment: 'neutral' })
      .mockResolvedValueOnce({ id: 'c3', content: 'nope', alignment: 'negative' });
    mockPrisma.pendingComment.update.mockResolvedValue({});

    const candidates = [
      { content: 'ok', alignment: 'positive', rationale: '' },
      { content: 'hmm', alignment: 'neutral', rationale: '' },
      { content: 'nope', alignment: 'negative', rationale: '' },
    ];

    mockAiService.runPipeline.mockResolvedValue({
      summary: 'A post',
      sentiment: {
        sentiment: 'positive',
        positive_pct: 60,
        neutral_pct: 30,
        negative_pct: 10,
        trend_summary: 'positive vibes',
      },
      candidates,
    });
    mockAiService.selectAfkCandidate.mockReturnValue(candidates[0]); // positive

    await processor.handleProcessPost({ data: { kolPostId: 'p1', kolId: 'k1' } } as any);

    expect(mockEngagementQueue.add).toHaveBeenCalledWith(
      'post-comment',
      expect.objectContaining({ pendingCommentId: 'c1' }),
      expect.objectContaining({ delay: expect.any(Number) }),
    );
    expect(mockTelegramQueue.add).not.toHaveBeenCalled();
  });
});
