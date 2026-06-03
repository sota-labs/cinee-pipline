# Phase 00 — Clean Up PersonaKnowledge Dead Code

**Priority:** P1 (blocker for phases 01-04 — reduces confusion)
**Status:** Pending
**Blocked by:** none
**Blocks:** nothing, but recommended before Phase 01

---

## Context Links

- Model file: `src/db/models/PersonaKnowledge.ts` (4 exports, no consumers in prompt pipeline)
- Barrel re-export: `src/db/index.ts:7, 34`
- 2 API routes: `src/routes/tools.ts:220-242` (`POST /api/tools/db/persona`, `GET /api/tools/db/persona`)
- DO NOT TOUCH: `src/routes/account.ts` — uses `OwnAccountProfile`, different model
- DO NOT TOUCH: `src/routes/topicConfig.ts` — `persona` field on `TopicConfig`, unrelated

---

## Overview

`PersonaKnowledge` is a manual KV store for persona facts (topic → stance → notes → confidence). The bot prompt pipeline never reads it. The 2 `/api/tools/db/persona` routes are admin-only write paths into this orphan model. They inflate the public API surface, confuse new contributors, and add 1 collection + 2 endpoints that nothing depends on.

**Goal:** remove the model, the barrel re-export, and the 2 routes. Zero behavior change for any active pipeline.

---

## Requirements

- No file outside the 3 listed locations references `PersonaKnowledge`. Confirmed via grep on 2026-06-02.
- After deletion, `npm run build` (or `tsc --noEmit`) must pass with zero new errors.
- No Mongoose model registration for the removed schema.
- The 2 routes return `404` (or the entire `toolsRouter` continues to serve other `/db/*` routes — verify no other route depends on shared state).

---

## Architecture

Pure deletion. No new code, no migration, no data archival. The collection in MongoDB can be dropped manually later (out of scope; the data is admin-only and ephemeral).

---

## Related Code Files

### Files to delete
- `src/db/models/PersonaKnowledge.ts`

### Files to modify
- `src/db/index.ts` — remove 2 lines:
  - line 7: `export { PersonaKnowledge } from "./models/PersonaKnowledge.js";`
  - line 34: `export type { IPersonaKnowledge } from "./models/PersonaKnowledge.js";`
- `src/routes/tools.ts` — remove 1 import line + 2 route handlers:
  - line 8: `PersonaKnowledge` from the named import
  - lines 220-242: both `toolsRouter.post("/db/persona", ...)` and `toolsRouter.get("/db/persona", ...)`

---

## Implementation Steps

1. **Verify no hidden consumers** — run `grep -rn "PersonaKnowledge\|IPersonaKnowledge" src/ tests/ 2>/dev/null`. Expect only the 3 files above. If more appear, STOP and re-investigate.
2. **Read the exact lines** in `src/db/index.ts:7,34` and `src/routes/tools.ts:8,220-242` to confirm current state.
3. **Edit `src/db/index.ts`** — remove the 2 export lines.
4. **Edit `src/routes/tools.ts`** — remove `PersonaKnowledge` from the import on line 8, then delete the 2 route blocks (lines 220-242).
5. **Delete the model file** — `rm src/db/models/PersonaKnowledge.ts`.
6. **Verify build** — `npx tsc --noEmit` (or whatever the project's typecheck command is — check `package.json` `scripts`).
7. **Verify routes** — start the server, `curl -X POST http://localhost:PORT/api/tools/db/persona` should now return 404 (not 500).

---

## Todo List

- [ ] Grep verify (step 1)
- [ ] Edit `src/db/index.ts` (step 3)
- [ ] Edit `src/routes/tools.ts` (step 4)
- [ ] Delete model file (step 5)
- [ ] `npx tsc --noEmit` passes
- [ ] 404 confirmed on deleted routes
- [ ] Commit: `chore: remove unused PersonaKnowledge model + 2 dead API routes`

---

## Success Criteria

- `npx tsc --noEmit` passes.
- `grep -rn "PersonaKnowledge" src/` returns zero matches.
- The 2 deleted routes return 404.
- All other routes in `toolsRouter` still work (smoke test 1-2 of them).
- No diff to `package.json`, no diff to any service/prompt/route file outside the 3 listed.

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Hidden consumer discovered after deletion | Low | Grep before editing |
| Build breaks from stale import | Low | `tsc --noEmit` after edit |
| Routes 500 instead of 404 | Very low | Express auto-404s on unregistered paths |

---

## Security Considerations

- The 2 deleted routes were admin-only KV writes. Removing them tightens the public API surface — net positive.
- The MongoDB collection itself is not dropped (intentional — preserves admin data for forensic rollback if needed). Manual `db.personaknowledges.drop()` is a separate decision.

---

## Next Steps

After Phase 0: proceed to Phase 1 (auto-learn cron). The `personality` routes in `src/routes/account.ts` are unrelated and stay.
