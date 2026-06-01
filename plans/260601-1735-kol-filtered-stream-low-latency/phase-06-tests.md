# Phase 06 — Write Tests

**Spec:** [spec.md](./spec.md) | **Plan:** [plan.md](./plan.md)

## Overview

- **Priority:** P1
- **Status:** Pending
- **Effort:** 3h
- **Blocked by:** Phases 01, 02, 03, 04

Write unit and integration tests for the new stream components. Follow existing test patterns in `src/tests/`.

## Key Insights

- Existing tests use Vitest (`src/tests/xApiClient.test.ts`, `kolCrawlerIntegration.test.ts`)
- Mock `fetch` for xApiClient stream tests — same pattern as existing xApiClient tests
- For `kolStreamService` tests: mock `connectFilteredStream`, `addStreamRules`, `deleteStreamRules`, `getStreamRules`
- Integration test: mock stream event → verify post saved + tasks queued (check Task documents in DB)

## Related Code Files

- **Create:** `src/tests/xApiClientStream.test.ts`
- **Create:** `src/tests/kolStreamService.test.ts`
- **Read (reference):** `src/tests/xApiClient.test.ts` — mock patterns
- **Read (reference):** `src/tests/kolCrawlerIntegration.test.ts` — integration patterns

## Implementation Steps

### xApiClientStream.test.ts

1. Test `getStreamRules()`:
   - Mock fetch returning `{ data: [{ id: '1', value: 'from:123', tag: 'kol-stream-0' }] }`
   - Assert returns array of `IStreamRule`
   - Test empty response (`{ data: undefined }`) → returns `[]`

2. Test `addStreamRules()`:
   - Mock fetch returning created rules with IDs
   - Assert correct POST body `{ add: rules }`

3. Test `deleteStreamRules()`:
   - Mock fetch returning success
   - Assert correct POST body `{ delete: { ids } }`
   - Test empty array → no fetch call

4. Test `connectFilteredStream()`:
   - Mock fetch with a ReadableStream that emits chunks
   - Assert `onData` called for non-empty lines
   - Assert empty lines (heartbeat) are skipped
   - Assert disconnect function cancels reader

### kolStreamService.test.ts

5. Test `buildStreamRules()`:
   - 15 KOLs → 1 rule
   - 16 KOLs → 2 rules
   - KOLs without `x_user_id` → excluded, warning logged
   - Rule value format: `(from:ID1 OR from:ID2 ...) -is:retweet`

6. Test `syncRules()`:
   - No existing rules → adds all desired
   - Existing rules with `kol-stream-` tag → deletes all, adds new
   - Non-kol-stream rules → preserved (not deleted)

7. Test `parseStreamEvent()`:
   - Valid JSON with tweet data → returns tweet
   - Empty line → returns null
   - Malformed JSON → returns null, logs debug

8. Test reconnect backoff:
   - Simulate stream error → verify reconnect scheduled
   - Verify backoff doubles each attempt up to 5min cap

### Regression

9. Run existing crawler tests: `npm test -- kolCrawler`
   - Verify top-2 cap removal doesn't break existing test assertions
   - Update test expectations if they assert exactly 2 posts saved

## Todo List

- [ ] Create `src/tests/xApiClientStream.test.ts` with 4 test groups
- [ ] Create `src/tests/kolStreamService.test.ts` with 4 test groups
- [ ] Run `npm test` — all tests pass
- [ ] Fix any regression in existing crawler tests from top-2 cap removal

## Success Criteria

- All new tests pass
- All existing tests pass
- No test uses fake data or mocks that bypass real logic
