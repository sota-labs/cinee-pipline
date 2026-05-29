---
phase: 01
title: Config & Model
status: pending
priority: high
---

# Phase 01 — Config & Model

## Context Links

- Spec: `plans/260529-1500-x-api-hybrid-platform-architecture/spec.md`
- Plan: `plans/260529-1500-x-api-hybrid-platform-architecture/plan.md`
- Settings: `src/config/settings.ts`
- KolProfile model: `src/db/models/KolProfile.ts`

## Overview

- Priority: high (blocks all other phases)
- Status: pending
- Add `X_API_BEARER_TOKEN` to settings with fail-fast validation. Add `x_user_id?: string` to KolProfile for caching resolved X numeric user IDs.

## Key Insights

- `settings.ts` uses dotenv + singleton export pattern — add to `Settings` interface and `settings` object
- Fail-fast: throw at startup if token missing (not at first API call)
- `x_user_id` is optional — null until first crawl resolves it via `/2/users/by/username/:handle`
- No migration script needed — MongoDB adds optional fields lazily; existing documents just have `undefined`

## Requirements

- `settings.xApiBearerToken` available at import time
- Startup throws `Error` with clear message if `X_API_BEARER_TOKEN` env var is missing
- `IKolProfile.x_user_id?: string` field on interface and schema
- `.env.example` documents the new var

## Architecture

```
settings.ts
  Settings interface  +  xApiBearerToken: string
  settings object     +  xApiBearerToken: process.env.X_API_BEARER_TOKEN (validated)

KolProfile.ts
  IKolProfile interface  +  x_user_id?: string
  kolProfileSchema       +  x_user_id: { type: String, index: true, sparse: true }
```

## Related Code Files

- Modify: `src/config/settings.ts`
- Modify: `src/db/models/KolProfile.ts`
- Modify: `.env.example` (if exists, else create)

## Implementation Steps

1. Open `src/config/settings.ts`.
2. Add `xApiBearerToken: string` to the `Settings` interface.
3. After the `settings` object is constructed, add a fail-fast guard:
   ```typescript
   const xApiBearerToken = process.env.X_API_BEARER_TOKEN;
   if (!xApiBearerToken) {
     throw new Error('[settings] X_API_BEARER_TOKEN is required but not set');
   }
   ```
4. Add `xApiBearerToken` to the exported `settings` object.
5. Open `src/db/models/KolProfile.ts`.
6. Add `x_user_id?: string` to `IKolProfile` interface.
7. Add to `kolProfileSchema`:
   ```typescript
   x_user_id: { type: String, default: null, index: true, sparse: true },
   ```
8. Add/update `.env.example` with:
   ```
   X_API_BEARER_TOKEN=your_x_api_bearer_token_here
   ```
9. Run `npm run build` to verify no TypeScript errors.

## Todo List

- [ ] Add `xApiBearerToken: string` to `Settings` interface
- [ ] Add fail-fast validation in settings.ts
- [ ] Add `xApiBearerToken` to `settings` export object
- [ ] Add `x_user_id?: string` to `IKolProfile` interface
- [ ] Add `x_user_id` field to kolProfileSchema
- [ ] Update `.env.example`
- [ ] Verify `npm run build` passes

## Success Criteria

- `settings.xApiBearerToken` is typed as `string` (not `string | undefined`)
- Process exits with clear error if `X_API_BEARER_TOKEN` is unset
- `KolProfile.x_user_id` field exists in schema with sparse index
- TypeScript build passes

## Risk Assessment

- Low risk — additive changes only, no existing logic modified
- Sparse index on `x_user_id` avoids index bloat for documents without the field

## Security Considerations

- Bearer token loaded from env var only — never hardcoded
- Token value never logged

## Next Steps

- Phase 02 imports `settings.xApiBearerToken` for Authorization header
- Phase 02 reads/writes `KolProfile.x_user_id` for user ID caching
