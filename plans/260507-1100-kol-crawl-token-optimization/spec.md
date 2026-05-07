# Spec: KOL Crawl Token Optimization via JS Injection

## Problem Statement

Current KOL crawl tasks use verbose LLM prompts (~180 lines) that instruct OpenClaw agent to
reason through each DOM extraction step. This causes:
- LLM token cost per crawl: high (each browser action = LLM reasoning cycle)
- Execution timeout: tasks consistently timeout at 300s for 2+ KOLs
- Payload size: `task.prompt` field stores ~4KB per batch task

Root cause: OpenClaw is being used as a "thinking browser" when it only needs to be a
"script runner" for the crawl phase. Analysis/reply still legitimately needs LLM.

## User Stories

- As a system operator, I want KOL batch crawl to complete within 60s for 5 KOLs
- As a developer, I want crawl prompt size reduced so task records stay lean
- As a system, crawl result schema must remain identical (no downstream changes)

## Approach: Minimal-Prompt JS Injection (chosen)

Replace verbose natural-language instructions with a short prompt that embeds a static
JavaScript extraction script. OpenClaw navigates the browser (retaining its authenticated
session), injects the script, and returns structured JSON. BE validates and saves.

```
BEFORE (per batch, 2 KOLs):          AFTER:
- Prompt: ~180 lines                  - Prompt: ~15 lines
- Agent reasoning: per-element        - Agent reasoning: navigate + inject only
- Token cost: ~3000-5000 tokens       - Token cost: ~300-500 tokens (~90% reduction)
- Execution: 300s+ (timeout)          - Execution: ~20-40s for 5 KOLs
```

**Not changed:** worker.js, Task model, API routes, DB schema, analysis/reply flow.

## Architecture

```
[BE - Machine A]                         [Worker - Machine B]
kolCrawlerService.ts                     worker.js → openclaw agent
  │                                           │
  ├─ buildJsInjectionPrompt(kols)             │  1. Navigate to x.com/{handle}
  │   → short prompt + static JS script      │  2. Scroll 3x to load tweets
  │                                          │  3. page.evaluate(EXTRACTION_SCRIPT)
  ├─ Task.create({ prompt })                 │  4. Return JSON result
  │                                          │
  └─ processBatchCrawlResult(taskResult) ←──┘
      → validate JSON schema
      → normalize numbers (1.2K → 1200)
      → save KolPost records
```

## Components

### 1. Static JS Extraction Scripts (new)
**File:** `src/utils/kolCrawlScript.ts`

Two static JS strings injected via OpenClaw's `page.evaluate()`. Both run in browser context.

```typescript
// Runs inside browser — no imports, no TypeScript
export const KOL_TWEET_SCRIPT = `
(function() {
  function parseCount(str) {
    if (!str) return 0;
    const s = str.replace(/,/g, '').trim();
    if (s.endsWith('K')) return Math.round(parseFloat(s) * 1000);
    if (s.endsWith('M')) return Math.round(parseFloat(s) * 1000000);
    return parseInt(s) || 0;
  }
  const tweets = [...document.querySelectorAll('[data-testid="tweet"]')];
  return tweets.map(t => {
    const timeEl = t.querySelector('time');
    const linkEl = timeEl?.closest('a');
    return {
      post_url: linkEl ? 'https://x.com' + linkEl.getAttribute('href') : '',
      content: t.querySelector('[data-testid="tweetText"]')?.innerText?.slice(0, 500) || '',
      posted_at: timeEl?.getAttribute('datetime') || '',
      likes: parseCount(t.querySelector('[data-testid="like"] span')?.innerText),
      comments: parseCount(t.querySelector('[data-testid="reply"] span')?.innerText),
      retweets: parseCount(t.querySelector('[data-testid="retweet"] span')?.innerText),
      views: parseCount(t.querySelector('[data-testid="analytics"] span')?.innerText),
      media_urls: [...t.querySelectorAll('[data-testid="tweetPhoto"] img, [data-testid="videoPlayer"] video')]
                    .map(el => el.src || el.poster).filter(Boolean),
    };
  }).filter(p => p.content && p.post_url);
})()
`;

// Run on a post detail page to extract top comments (skip index 0 = original post)
export const KOL_COMMENT_SCRIPT = `
(function() {
  function parseCount(str) {
    if (!str) return 0;
    const s = str.replace(/,/g, '').trim();
    if (s.endsWith('K')) return Math.round(parseFloat(s) * 1000);
    if (s.endsWith('M')) return Math.round(parseFloat(s) * 1000000);
    return parseInt(s) || 0;
  }
  const items = [...document.querySelectorAll('[data-testid="tweet"]')].slice(1, 11);
  return items.map(c => ({
    content: c.querySelector('[data-testid="tweetText"]')?.innerText?.slice(0, 300) || '',
    author_handle: (c.querySelector('[data-testid="User-Name"] a')?.href || '').split('/').pop() || '',
    likes: parseCount(c.querySelector('[data-testid="like"] span')?.innerText),
    reply_count: parseCount(c.querySelector('[data-testid="reply"] span')?.innerText),
  })).filter(c => c.content);
})()
`;
```

### 2. New Prompt Templates (replace existing)
**File:** `src/services/kolCrawlerService.ts` — replace `KOL_CRAWL_PROMPT_TEMPLATE` and `BATCH_KOL_CRAWL_PROMPT_TEMPLATE`

Top comments require navigating into each post URL — this is handled in the prompt as a
conditional step, still using JS injection (not LLM reasoning).

```typescript
// Single KOL — ~15 lines
const KOL_CRAWL_PROMPT_TEMPLATE = `
1. Navigate to https://x.com/{{handle}}, wait 8s, scroll 3x (2s each).
2. Run TWEET_SCRIPT, collect posts array.
3. For each post where comments > 10 (max 5 posts):
   a. Navigate to post_url, wait 4s
   b. Run COMMENT_SCRIPT, add result as top_comments on that post
   c. Navigate back
4. Return JSON: {"posts": <posts array with top_comments populated>}

TWEET_SCRIPT: ${KOL_TWEET_SCRIPT}
COMMENT_SCRIPT: ${KOL_COMMENT_SCRIPT}
${OUTPUT_FORMAT_INSTRUCTION}`;

// Batch — ~18 lines
const BATCH_KOL_CRAWL_PROMPT_TEMPLATE = `
For each handle below, sequentially:
1. Navigate to https://x.com/{handle}, wait 8s, scroll 3x (2s each)
2. Run TWEET_SCRIPT, collect posts
3. For each post where comments > 10 (max 5 posts per KOL):
   a. Navigate to post_url, wait 4s
   b. Run COMMENT_SCRIPT, add as top_comments
   c. Navigate back to profile
4. Wait 10s before next handle

Handles: {{handleList}}

Extraction script (run via page.evaluate on each page):
\`\`\`
${KOL_EXTRACTION_SCRIPT}
\`\`\`

Return JSON: {"results": [{"handle": "...", "posts": [...]}]}
${OUTPUT_FORMAT_INSTRUCTION}`;
```

### 3. Result Validator/Normalizer (new)
**File:** `src/utils/kolCrawlResultParser.ts`

Validates and normalizes the JSON returned by OpenClaw before saving.

```typescript
export interface IRawPost { ... } // existing interface, move here

export function parseBatchCrawlResult(raw: string): Array<{ handle: string; posts: IRawPost[] }> {
  // 1. Extract JSON from RESPONSE delimiters (reuse extractResponse)
  // 2. JSON.parse
  // 3. Validate shape: results array, each has handle + posts array
  // 4. Normalize: ensure all numeric fields are numbers (not strings)
  // 5. Filter: posts with empty content or post_url
  // Throws descriptive error if shape invalid
}

export function parseSingleCrawlResult(raw: string): IRawPost[] {
  // Same as above but for single KOL format
}
```

### 4. processBatchCrawlResult integration
**File:** `src/services/kolCrawlerService.ts` — new exported function

Called by the route/scheduler after task completes, replacing manual JSON parsing.

```typescript
export async function processBatchCrawlResult(taskResult: string, handles: string[]): Promise<ICrawlResult[]>
```

- Calls `parseBatchCrawlResult(taskResult)`
- For each handle, looks up `KolProfile` by handle
- Calls existing `processCrawlResults(kolId, posts)` per handle
- Updates `last_crawled_at` and Redis cache per handle
- Returns array of `ICrawlResult`

## Data Flow

```
1. Scheduler triggers crawlAllKolsSequential()
2. kolCrawlerService builds short prompt with embedded JS script
3. Task.create({ prompt, payload: { action: "batch_crawl", handles } })
4. worker.js polls → picks up task → spawns openclaw
5. openclaw: navigate → scroll → page.evaluate(script) → returns JSON
6. worker.js: extractResponse(output) → PATCH /api/tasks/:id/complete { result: jsonStr }
7. [Next step - currently manual, can be webhook later]:
   processBatchCrawlResult(task.result, task.payload.handles)
   → parseBatchCrawlResult → processCrawlResults → KolPost.create
```

**Note on step 7:** Currently `processBatchCrawlResult` must be triggered manually or via
a polling mechanism since BE and worker are on separate machines. This spec does not add
a webhook — that's a separate concern. For now, a `POST /api/tasks/:id/process-result`
endpoint exposes the processing so it can be called manually or scheduled.

## Interface Contracts

### Task payload (unchanged)
```typescript
{ action: "batch_crawl", kolCount: number, handles: string[] }
```

### OpenClaw output (new expected format)
```json
<<<RESPONSE_START>>>
{"results": [{"handle": "foo", "posts": [{...}]}]}
<<<RESPONSE_END>>>
```

### processBatchCrawlResult input/output
```typescript
input:  taskResult: string  // raw task.result from DB
        handles: string[]   // from task.payload.handles
output: ICrawlResult[]      // existing type, unchanged
```

## Error Handling

| Scenario | Handling |
|----------|----------|
| OpenClaw returns malformed JSON | parseBatchCrawlResult throws → log error, task stays completed, result preserved |
| Handle not found in KolProfile | Skip that handle, continue others, log warning |
| Partial results (some KOLs missing) | Process what's available, log missing handles |
| Script finds 0 tweets (page not loaded) | posts: [] for that handle, not an error |
| Twitter selector changes | Script returns empty → alert via log, fallback to raw text in result |

## New API Endpoint

`POST /api/tasks/:id/process-result`
- Reads task by ID, checks status === "completed"
- Reads `task.payload.handles` and `task.result`
- Calls `processBatchCrawlResult(task.result, handles)`
- Returns `{ success, results: ICrawlResult[] }`
- Idempotent: calling twice just re-processes (dedup handled by `post_url` unique index)

## Files to Change

| File | Change |
|------|--------|
| `src/services/kolCrawlerService.ts` | Replace prompt templates, add `processBatchCrawlResult` |
| `src/routes/tasks.ts` | Add `POST /:id/process-result` endpoint |
| `src/utils/kolCrawlScript.ts` | **New** — static JS extraction script |
| `src/utils/kolCrawlResultParser.ts` | **New** — JSON validator/normalizer |

**No changes to:** worker.js, Task model, KolPost model, KolProfile model, other routes.

## Testing Strategy

1. **Unit: kolCrawlResultParser** — test with valid JSON, malformed JSON, partial results, empty posts, posts with/without top_comments
2. **Unit: KOL_TWEET_SCRIPT / KOL_COMMENT_SCRIPT** — test parseCount() with "1.2K", "3.5M", plain numbers, null
3. **Integration: POST /api/tasks/:id/process-result** — seed a completed task, call endpoint, verify KolPost records including top_comments
4. **Manual: openclaw JS injection** — run one task against real x.com/handle, verify JSON shape and that comment navigation works

## Success Metrics

| Metric | Before | Target |
|--------|--------|--------|
| Prompt token count (batch 2 KOLs) | ~3000-5000 | < 600 |
| Task execution time (2 KOLs) | 300s (timeout) | < 60s |
| task.prompt field size | ~4KB | < 800 bytes |
| Crawl result schema | unchanged | unchanged |

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Twitter changes `data-testid` selectors | Medium | Centralize selectors in `kolCrawlScript.ts`, easy to update |
| OpenClaw page.evaluate syntax differs | Low | Test with simple script first before full deploy |
| Lazy-loaded tweets not captured | Medium | 3x scroll with 2s delay covers most timelines |
| Top comments — post navigation adds time | Medium | Max 5 posts/KOL with comments > 10; adds ~20s/KOL, still within 60s target |
| Navigate back fails after comment page | Low | Batch prompt uses explicit "navigate back to profile" instruction |

## Out of Scope (Phase 2)

- Webhook from worker → BE for automatic result processing
- Parallelizing multiple KOLs across multiple worker machines
