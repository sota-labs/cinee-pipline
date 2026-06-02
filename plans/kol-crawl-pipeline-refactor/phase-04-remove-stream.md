# Phase 4 — Remove Stream Mechanism

## Context Links
- Files to delete: `src/scripts/kolStreamWorker.ts`, `src/services/kolStreamService.ts`, `src/services/platforms/x/xStreamTypes.ts`
- Re-exports to scrub: `src/services/platforms/x/xApiClient.ts:5-6`
- Script to remove from `package.json`: `"stream:kol"`
- `crawlDueKols` to delete: `src/services/kolCrawlerService.ts:540-619`

## Overview
- **Priority**: P1
- **Status**: pending
- **Description**: Remove all X Filtered Stream code paths and the now-redundant `crawlDueKols`. The goal is a clean repo with no dead stream-related imports.

## Requirements

### Functional
1. Delete the three stream-related files.
2. Remove the `stream:kol` script from `package.json`.
3. Scrub the two re-export lines in `xApiClient.ts`:
   ```typescript
   // DELETE:
   export { getStreamRules, addStreamRules, deleteStreamRules, connectFilteredStream } from "./xStreamTypes.js";
   export type { IStreamRule, IStreamRuleAdd } from "./xStreamTypes.js";
   ```
4. Delete the `crawlDueKols` function and its `ICrawlSpawnResult` interface from `kolCrawlerService.ts`. Remove unused imports (`KolSettings`, `ITierCrawlIntervals`, `XRateLimitError` — keep `XRateLimitError` only if still used by `crawlKol`; check first).
5. Update any remaining references (greppable):
   - `kolCrawlerService.ts` — re-check imports after deletion.
   - `kolSettings.ts` route — no changes expected (no stream refs).
   - `tests/kolCrawlerIntegration.test.ts` — no stream references in the current file; remove the `XRateLimitError` import mock only if `crawlDueKols` was the sole consumer. (Phase 5 will handle test changes.)
6. CHANGELOG entry: "Removed X Filtered Stream worker and `crawlDueKols`; replaced by prime-window X API poll + OpenClaw batch tasks."

### Non-functional
- Zero new functionality — pure deletion.
- `npm run typecheck` must pass after deletion.
- `grep -r "kolStream\|xStream\|filteredStream\|connectFilteredStream\|stream:kol" src/ package.json` must return zero matches.

## Architecture
N/A — deletion only.

## Related Code Files

### Delete
- `src/scripts/kolStreamWorker.ts`
- `src/services/kolStreamService.ts`
- `src/services/platforms/x/xStreamTypes.ts`

### Modify
- `src/services/platforms/x/xApiClient.ts` — remove re-exports (lines 5-6).
- `src/services/kolCrawlerService.ts` — delete `crawlDueKols` and `ICrawlSpawnResult`; clean unused imports.
- `package.json` — remove `"stream:kol"` line.
- `docs/project-changelog.md` — add entry.

## Implementation Steps

1. Verify no external caller references the deleted functions/files:
   ```bash
   grep -rn "kolStreamService\|kolStreamWorker\|xStreamTypes\|connectFilteredStream\|crawlDueKols\|ICrawlSpawnResult" src/ docs/ tests/
   ```
2. Delete the three files (Bash `rm`).
3. Edit `xApiClient.ts` to remove the two re-export lines.
4. Edit `kolCrawlerService.ts`:
   - Remove `crawlDueKols` (lines 540-619).
   - Remove `ICrawlSpawnResult` (lines 542-545).
   - Check `XRateLimitError` is still used by `crawlKol` (it is — keep).
   - Check `KolSettings` and `ITierCrawlIntervals` imports — used elsewhere? No after deletion — remove.
5. Edit `package.json` to remove the `stream:kol` line.
6. Edit `docs/project-changelog.md` to add an entry under the current "pending" or "in-progress" section.
7. Run `npm run typecheck`.
8. Run `grep` to verify zero remaining references.

## Todo List
- [ ] Three files deleted
- [ ] xApiClient re-exports removed
- [ ] crawlDueKols deleted
- [ ] package.json stream:kol removed
- [ ] CHANGELOG entry added
- [ ] typecheck passes
- [ ] grep returns zero stream refs

## Success Criteria
- `grep -r "stream:kol\|kolStream\|xStream\|connectFilteredStream" . --include="*.ts" --include="*.json" --include="*.md"` returns zero matches outside of `docs/system-architecture.md` (which is updated in Phase 6) and `plans/` (history).

## Risk Assessment
- **Low risk**: all references are internal. The `cinee-worker` process (separate repo) does not depend on any of this code.

## Open Questions
- The user noted: "user may want to keep git history." — `git rm` preserves history. We use `rm` (Bash) and let git track the deletion on the next commit. No additional action needed.

## Next Steps
- Phase 5: tests.
