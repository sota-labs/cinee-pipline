import { buildVisibilityCheckPrompt } from './kol-prompts';

const API = 'http://localhost:3000';

describe('buildVisibilityCheckPrompt', () => {
  it('includes the comment URL and ID', () => {
    const prompt = buildVisibilityCheckPrompt('https://x.com/u/status/123', 'c1', 1, API);
    expect(prompt).toContain('https://x.com/u/status/123');
    expect(prompt).toContain('c1');
  });

  it('includes the callback URL', () => {
    const prompt = buildVisibilityCheckPrompt('https://x.com/u/status/123', 'c1', 2, API);
    expect(prompt).toContain(`${API}/api/tools/kol/comments/c1/visibility-result`);
  });

  it('includes check index in output', () => {
    const prompt = buildVisibilityCheckPrompt('https://x.com/u/status/123', 'c1', 2, API);
    expect(prompt).toContain('Check 2');
  });

  it('lists all four visibility states', () => {
    const prompt = buildVisibilityCheckPrompt('https://x.com/u/status/123', 'c1', 1, API);
    expect(prompt).toContain('visible');
    expect(prompt).toContain('collapsed');
    expect(prompt).toContain('flagged');
    expect(prompt).toContain('unknown');
  });
});
