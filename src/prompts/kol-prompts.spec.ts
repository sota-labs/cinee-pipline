import {
  buildKolCrawlPrompt,
  buildKolStyleLearnPrompt,
  buildKolPostScrapePrompt,
  buildPostCommentPrompt,
} from './kol-prompts';
import { KOL_CONSTANTS } from '../common/constants/kol.constants';

const API = 'http://localhost:3000';

describe('buildKolCrawlPrompt', () => {
  it('includes all KOL handles in output', () => {
    const kols = [
      { id: 'k1', handle: 'alice', platform: 'x', profileUrl: '' },
      { id: 'k2', handle: 'bob', platform: 'x', profileUrl: 'https://x.com/bob' },
    ];
    const prompt = buildKolCrawlPrompt(kols, API);
    expect(prompt).toContain('@alice');
    expect(prompt).toContain('@bob');
    expect(prompt).toContain(`${API}/api/tools/kol/`);
  });

  it('includes the API callback URL', () => {
    const prompt = buildKolCrawlPrompt(
      [{ id: 'k1', handle: 'alice', platform: 'x', profileUrl: '' }],
      API,
    );
    expect(prompt).toContain(API);
    expect(prompt).toContain('posts/ingest');
  });

  it('falls back to x.com URL when profileUrl is empty', () => {
    const prompt = buildKolCrawlPrompt(
      [{ id: 'k1', handle: 'testuser', platform: 'x', profileUrl: '' }],
      API,
    );
    expect(prompt).toContain('https://x.com/testuser');
  });

  it('uses profileUrl when provided', () => {
    const prompt = buildKolCrawlPrompt(
      [{ id: 'k1', handle: 'testuser', platform: 'x', profileUrl: 'https://x.com/custom' }],
      API,
    );
    expect(prompt).toContain('https://x.com/custom');
  });

  it('includes the KOL count in the prompt', () => {
    const kols = Array.from({ length: 3 }, (_, i) => ({
      id: `k${i}`,
      handle: `user${i}`,
      platform: 'x',
      profileUrl: '',
    }));
    const prompt = buildKolCrawlPrompt(kols, API);
    expect(prompt).toContain('3 X.com profiles');
  });
});

describe('buildKolStyleLearnPrompt', () => {
  const kolFull = {
    id: 'k1',
    handle: 'alice',
    platform: 'x',
    profileUrl: '',
    styleSummary: '',
    personalityNotes: '',
    slangVocab: [],
    writingSamples: [],
  };

  it('includes the KOL handle', () => {
    const prompt = buildKolStyleLearnPrompt(kolFull, API);
    expect(prompt).toContain('@alice');
    expect(prompt).toContain('k1');
  });

  it('includes the style-learn callback URL', () => {
    const prompt = buildKolStyleLearnPrompt(kolFull, API);
    expect(prompt).toContain(`${API}/api/tools/kol/k1/style-learn/result`);
  });

  it('references MAX_WRITING_SAMPLES constant', () => {
    const prompt = buildKolStyleLearnPrompt(kolFull, API);
    expect(prompt).toContain(String(KOL_CONSTANTS.MAX_WRITING_SAMPLES));
  });

  it('falls back to x.com URL when profileUrl is empty', () => {
    const prompt = buildKolStyleLearnPrompt(kolFull, API);
    expect(prompt).toContain('https://x.com/alice');
  });
});

describe('buildKolPostScrapePrompt', () => {
  it('includes post URL and IDs', () => {
    const postUrl = 'https://x.com/kol/status/123';
    const prompt = buildKolPostScrapePrompt('kol1', 'post1', postUrl, API);
    expect(prompt).toContain(postUrl);
    expect(prompt).toContain('post1');
    expect(prompt).toContain(`${API}/api/tools/kol/posts/post1/processing/result`);
  });

  it('references TOP_COMMENT_COUNT constant', () => {
    const prompt = buildKolPostScrapePrompt('kol1', 'post1', 'https://x.com/kol/status/123', API);
    expect(prompt).toContain(String(KOL_CONSTANTS.TOP_COMMENT_COUNT));
  });
});

describe('buildPostCommentPrompt', () => {
  it('includes the comment content verbatim', () => {
    const content = 'great take on this fr';
    const prompt = buildPostCommentPrompt('https://x.com/kol/status/123', 'c1', content, API);
    expect(prompt).toContain(content);
    expect(prompt).toContain('c1');
    expect(prompt).toContain(`${API}/api/tools/kol/comments/c1/posted`);
  });

  it('includes the post URL', () => {
    const postUrl = 'https://x.com/kol/status/456';
    const prompt = buildPostCommentPrompt(postUrl, 'c2', 'some comment', API);
    expect(prompt).toContain(postUrl);
  });
});
