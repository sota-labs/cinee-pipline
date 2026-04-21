jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({})),
  };
});

import { KolStyleService } from './kol-style.service';

describe('KolStyleService.cosineSimilarity', () => {
  let service: KolStyleService;

  beforeEach(() => {
    service = new KolStyleService(null as any);
  });

  it('returns 1 for identical vectors', () => {
    const v = [1, 0, 0];
    expect((service as any).cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect((service as any).cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('returns 0 for zero vectors', () => {
    expect((service as any).cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});
