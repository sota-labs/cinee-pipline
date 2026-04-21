import { Test } from '@nestjs/testing';
import { AiProcessingService, SentimentResult, CommentCandidate } from './ai-processing.service';
import { KolStyleService } from '../kol/kol-style.service';

// Mock OpenAI
jest.mock('openai', () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
      embeddings: {
        create: jest.fn(),
      },
    })),
  };
});

const mockKolStyleService = {
  findSimilarExamples: jest.fn().mockResolvedValue([]),
};

describe('AiProcessingService', () => {
  let service: AiProcessingService;
  let openaiMock: { chat: { completions: { create: jest.Mock } } };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AiProcessingService,
        { provide: KolStyleService, useValue: mockKolStyleService },
      ],
    }).compile();

    service = module.get(AiProcessingService);
    openaiMock = (service as any).openai;
    jest.clearAllMocks();
  });

  describe('selectAfkCandidate', () => {
    const candidates: CommentCandidate[] = [
      { content: 'great!', alignment: 'positive', rationale: 'upbeat' },
      { content: 'meh', alignment: 'neutral', rationale: 'neutral' },
      { content: 'bad', alignment: 'negative', rationale: 'negative' },
    ];

    it('selects candidate matching dominant sentiment', () => {
      const sentiment: SentimentResult = {
        sentiment: 'positive',
        positive_pct: 70,
        neutral_pct: 20,
        negative_pct: 10,
        trend_summary: 'People are excited',
      };
      const selected = service.selectAfkCandidate(candidates, sentiment);
      expect(selected.alignment).toBe('positive');
    });

    it('treats mixed as positive', () => {
      const sentiment: SentimentResult = {
        sentiment: 'mixed',
        positive_pct: 50,
        neutral_pct: 30,
        negative_pct: 20,
        trend_summary: 'Mixed feelings',
      };
      const selected = service.selectAfkCandidate(candidates, sentiment);
      expect(selected.alignment).toBe('positive');
    });

    it('falls back to first candidate when no alignment match', () => {
      const noMatch: CommentCandidate[] = [
        { content: 'a', alignment: 'neutral', rationale: '' },
        { content: 'b', alignment: 'neutral', rationale: '' },
      ];
      const sentiment: SentimentResult = {
        sentiment: 'positive',
        positive_pct: 60,
        neutral_pct: 30,
        negative_pct: 10,
        trend_summary: '',
      };
      const selected = service.selectAfkCandidate(noMatch, sentiment);
      expect(selected.content).toBe('a');
    });
  });

  describe('analyzeSentiment', () => {
    it('returns neutral defaults when comments array is empty', async () => {
      const result = await service.analyzeSentiment([]);
      expect(result.sentiment).toBe('neutral');
      expect(result.neutral_pct).toBe(100);
    });

    it('parses OpenAI JSON response correctly', async () => {
      openaiMock.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                sentiment: 'negative',
                positive_pct: 10,
                neutral_pct: 20,
                negative_pct: 70,
                trend_summary: 'People are angry',
              }),
            },
          },
        ],
      });

      const result = await service.analyzeSentiment([
        { author_handle: 'user1', content: 'this is terrible', likes: 50, replies: 5 },
      ]);
      expect(result.sentiment).toBe('negative');
      expect(result.negative_pct).toBe(70);
      expect(result.trend_summary).toBe('People are angry');
    });
  });

  describe('summarizePost', () => {
    it('returns trimmed content from OpenAI', async () => {
      openaiMock.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: '  A post about crypto.  ' } }],
      });
      const result = await service.summarizePost('some post content');
      expect(result).toBe('A post about crypto.');
    });
  });

  describe('generateCandidates', () => {
    it('returns up to COMMENT_CANDIDATE_COUNT candidates', async () => {
      openaiMock.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                candidates: [
                  { content: 'c1', alignment: 'positive', rationale: 'r1' },
                  { content: 'c2', alignment: 'neutral', rationale: 'r2' },
                  { content: 'c3', alignment: 'negative', rationale: 'r3' },
                  { content: 'c4', alignment: 'positive', rationale: 'r4' }, // extra — should be sliced
                ],
              }),
            },
          },
        ],
      });

      const kol = {
        id: 'k1',
        styleSummary: 'short posts',
        personalityNotes: 'bullish',
        slangVocab: ['ser'],
      };
      const sentiment: SentimentResult = {
        sentiment: 'positive',
        positive_pct: 60,
        neutral_pct: 30,
        negative_pct: 10,
        trend_summary: '',
      };
      const result = await service.generateCandidates('post text', 'summary', sentiment, kol);
      expect(result).toHaveLength(3); // sliced to COMMENT_CANDIDATE_COUNT
    });
  });
});
