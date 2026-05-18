# Phase 01 — Manual Confirm Settings

**Priority:** Critical (blocks Phase 2)
**Status:** Pending

---

## Context Links

- Current model: `src/db/models/KolSettings.ts`
- Reference: `IManualSettings` interface (line 25)

---

## Overview

Add `auto_reject_after_minutes` to `IManualSettings` so the system knows when to auto-reject unconfirmed suggestions.

---

## Implementation Steps

### 1. Update `IManualSettings` interface

```typescript
export interface IManualSettings {
  notification_channel: string;
  max_pending_hours: number;
  auto_reject_after_minutes: number; // NEW — default 60
}
```

### 2. Update `manualSettingsSchema`

```typescript
const manualSettingsSchema = new Schema<IManualSettings>(
  {
    notification_channel: { type: String, default: "" },
    max_pending_hours: { type: Number, default: 24, min: 1 },
    auto_reject_after_minutes: { type: Number, default: 60, min: 5 },
  },
  { _id: false },
);
```

---

## Done When

- [ ] `IManualSettings` has `auto_reject_after_minutes` field
- [ ] Schema has default value of 60
- [ ] `npx tsc --noEmit` passes
