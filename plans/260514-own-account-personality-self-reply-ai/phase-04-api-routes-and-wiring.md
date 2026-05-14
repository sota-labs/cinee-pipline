# Phase 04 — API Routes + App Wiring + KOL Validation Guard

**Priority:** Medium
**Status:** Pending
**Blocked by:** Phase 01, Phase 02, Phase 03

---

## Context Links

- Researcher report: `plans/reports/researcher-own-account-personality.md`
- File to create: `src/routes/account.ts`
- File to modify: `src/app.ts`
- File to modify: `src/services/replyEngineService.ts`
- Pattern reference: `src/routes/kolSettings.ts` (CRUD route pattern)
- Service: `src/services/ownAccountService.ts` (Phase 02 output)

---

## Overview

Three changes:
1. Create `src/routes/account.ts` — REST endpoints for reading and updating own-account personality
2. Mount the router in `src/app.ts` at `/api/account`
3. Add a guard in `replyEngineService.generateSuggestions()` — if the KOL has no personality profile yet, queue learning and return early instead of generating empty suggestions

---

## Requirements

- Routes follow the same pattern as `kolSettings.ts` (try/catch, `res.json({ success, ... })`)
- `PATCH /api/account/personality/manual` accepts partial `IOwnAccountManualConfig` — validate that at least one field is present
- `POST /api/account/personality/learn` is a manual trigger — returns `{ taskId }` or `{ skipped: true }` if not enough posts
- Guard in `replyEngineService.ts` must not break existing KOL reply flow — only add early return when `personality_profile.writing_style` is empty/missing

---

## File to Create: `src/routes/account.ts` (~80 lines)

```typescript
/** Account routes — own-account personality management */
import { Router, type Request, type Response } from "express";
import { ownAccountService } from "../services/ownAccountService.js";
import type { IOwnAccountManualConfig } from "../db/models/OwnAccountProfile.js";

export const accountRouter = Router();

/**
 * GET /api/account/personality
 * Returns the current OwnAccountProfile (all three sub-docs).
 */
accountRouter.get("/personality", async (_req: Request, res: Response) => {
  try {
    const profile = await ownAccountService.getProfile();
    res.json({ success: true, profile });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/**
 * PATCH /api/account/personality/manual
 * Update manual_config fields. Recomputes effective_profile.
 * Body: Partial<IOwnAccountManualConfig>
 */
accountRouter.patch("/personality/manual", async (req: Request, res: Response) => {
  try {
    const config = req.body as Partial<IOwnAccountManualConfig>;

    if (!config || Object.keys(config).length === 0) {
      return res.status(400).json({ success: false, error: "Request body must contain at least one field" });
    }

    const profile = await ownAccountService.updateManualConfig(config);
    res.json({ success: true, profile });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/**
 * POST /api/account/personality/learn
 * Manually trigger personality learning from own posts.
 * Returns taskId if queued, or skipped: true if not enough posts.
 */
accountRouter.post("/personality/learn", async (_req: Request, res: Response) => {
  try {
    const taskId = await ownAccountService.learnPersonality();

    if (!taskId) {
      return res.json({ success: true, skipped: true, reason: "Not enough posts (minimum 10 required)" });
    }

    res.json({ success: true, taskId });
  } catch (e: unknown) {
    res.status(500).json({ success: false, error: (e as Error).message });
  }
});
```

---

## Changes to `src/app.ts`

### Add import:

```typescript
import { accountRouter } from "./routes/account.js";
```

### Mount router (add after `kolSettingsRouter` line):

```typescript
app.use("/api/account", accountRouter);
```

### Update root endpoint description:

```typescript
// In the res.json({ ... endpoints: { ... } }) object, add:
account: "/api/account/*",
```

---

## Changes to `src/services/replyEngineService.ts`

### Add guard in `generateSuggestions()`

Find the `generateSuggestions` method. After fetching the KOL profile, add a check before building the prompt:

```typescript
// After fetching kol profile (around where kol.personality_profile is accessed):
if (!kol.personality_profile?.writing_style) {
  log.info(`[ReplyEngine] KOL @${kol.handle} has no personality profile — queuing learn task`);
  // Queue personality learning for this KOL
  await kolAnalyzerService.learnPersonality(String(kol._id));
  return null; // Early return — suggestions will be generated after learning completes
}
```

**Exact placement:** Read `replyEngineService.ts` lines 80–150 during implementation to find where `kol.personality_profile` is first accessed. The guard goes immediately after the KOL fetch and before the prompt is built.

**Return type impact:** If `generateSuggestions()` currently returns `IGenerateSuggestionsResult`, the return type must allow `null`. Change to `Promise<IGenerateSuggestionsResult | null>` and update all callers (the webhook in `tasks.ts` already handles null via the `if (result)` check).

---

## API Endpoint Summary

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/account/personality` | Get full OwnAccountProfile |
| `PATCH` | `/api/account/personality/manual` | Update manual_config fields |
| `POST` | `/api/account/personality/learn` | Trigger personality learning |

---

## Todo List

- [ ] Create `src/routes/account.ts` with 3 endpoints
- [ ] Add `accountRouter` import to `src/app.ts`
- [ ] Mount `accountRouter` at `/api/account` in `src/app.ts`
- [ ] Update root endpoint description in `src/app.ts`
- [ ] Read `replyEngineService.ts` lines 80–150 to find exact guard placement
- [ ] Add `!kol.personality_profile?.writing_style` guard in `generateSuggestions()`
- [ ] Update `generateSuggestions()` return type to `Promise<IGenerateSuggestionsResult | null>` if needed
- [ ] Verify `tasks.ts` webhook handles `null` return from `generateSuggestions()` (it does — `if (result)` check exists)
- [ ] Run `tsc --noEmit` to verify compilation
- [ ] Run existing tests to confirm no regressions

---

## Success Criteria

- `GET /api/account/personality` returns `{ success: true, profile: { manual_config, learned_profile, effective_profile } }`
- `PATCH /api/account/personality/manual` with `{ "writing_style": "casual" }` updates `manual_config.writing_style` and recomputes `effective_profile`
- `POST /api/account/personality/learn` returns `{ taskId }` when ≥10 posts exist, `{ skipped: true }` otherwise
- `generateSuggestions()` returns `null` and queues learning when KOL has no `writing_style`
- All existing routes still work (no regressions in `app.ts`)

---

## Risk Assessment

- **Low:** Route creation is straightforward — follows existing patterns exactly
- **Medium:** `generateSuggestions()` return type change may require updating callers — check all call sites with `grep -r "generateSuggestions"` before modifying
- **Low:** `app.ts` mount is a one-liner addition

---

## Security Considerations

- `PATCH /api/account/personality/manual` accepts free-form text fields — no injection risk since values are stored as strings in MongoDB, not executed
- No authentication on these routes (consistent with existing API — add auth middleware if the project adds it globally)

---

## Next Steps

After all 4 phases complete:
1. Register `ownAccountLearnCron.ts` in `setupCronJobs.ts` with schedule `"0 3 * * *"`
2. Add `TWITTER_HANDLE` env var to `.env.example` if `settings.twitterHandle` doesn't exist
3. Run full test suite
4. Delegate to `code-reviewer` agent for review
