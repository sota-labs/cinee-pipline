# Threads Platform Abstraction Layer (Simplified) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend cinee-pipeline to create Tasks for both X and Threads platforms. Server-side cinee-worker polls and executes based on platform field. No separate worker service needed.

**Architecture:** TopicConfig gets `platform: 'x' | 'threads'` field. Services use PlatformAdapter pattern to create Tasks. Server-side cinee-worker already polls MongoDB and executes OpenClaw commands — it will handle both platforms based on Task.platform field.

**Tech Stack:** TypeScript, Express, MongoDB, Mongoose

**Estimated Duration:** 8-12 hours (simplified, no threads-worker service)

---

## File Structure Overview

### New Files to Create
```
src/integrations/
  ├── platformAdapter.ts          # Interface for platform operations
  ├── xAdapter.ts                 # X implementation (creates Tasks)
  ├── threadsAdapter.ts           # Threads implementation (creates Tasks)
  └── adapterFactory.ts           # Factory function

src/migrations/
  └── 001_add_platform_field.ts   # Migration: add platform to records

src/scripts/
  └── migrateToMultiPlatform.ts   # Migration runner

src/tests/
  ├── adapters.test.ts            # Adapter tests
  ├── schedulerService.platform.test.ts  # Service tests
  └── integration/
      └── multiPlatform.e2e.test.ts # E2E tests
```

### Modified Files
```
src/db/models/
  ├── TopicConfig.ts              # Add platform, threads_email, threads_password, tone_override
  └── Task.ts                     # Add platform field

src/services/
  ├── schedulerService.ts          # Make platform-aware, use adapters
  ├── schedulerPrompts.ts          # Add platform parameter for tone adaptation
  └── topicConfigService.ts        # Add getPlatformCredentials function

src/routes/
  ├── scheduler.ts                 # Add platform parameter support
  └── topicConfig.ts               # Handle platform fields in POST/PATCH

src/prompts/
  └── promptBuilder.ts             # Add platform parameter to builders
```

---

## Phase 1: Data Model Updates (1-2 hours)

### Task 1.1: Update TopicConfig Schema

**Files:**
- Modify: `src/db/models/TopicConfig.ts`

- [ ] **Step 1: Add platform-related fields to ITopicConfig interface**

Find the interface and add after `human_style_level`:
```typescript
platform: 'x' | 'threads';
threads_email?: string;
threads_password?: string;
tone_override?: {
  x?: string;
  threads?: string;
};
```

- [ ] **Step 2: Add schema fields for platform**

Add to schema after `human_style_level`:
```typescript
platform: {
  type: String,
  enum: ['x', 'threads'],
  default: 'x',
  required: true
},
threads_email: { type: String, default: "" },
threads_password: { type: String, default: "" },
tone_override: {
  type: { x: String, threads: String },
  default: {}
},
```

- [ ] **Step 3: Add indexes**

```typescript
topicConfigSchema.index({ platform: 1 });
topicConfigSchema.index({ is_active: 1, platform: 1 });
```

- [ ] **Step 4: Commit**

```bash
git add src/db/models/TopicConfig.ts
git commit -m "feat: add platform fields to TopicConfig schema"
```

---

### Task 1.2: Update Task Schema

**Files:**
- Modify: `src/db/models/Task.ts`

- [ ] **Step 1: Add platform field to ITask interface**

```typescript
platform: 'x' | 'threads';
```

- [ ] **Step 2: Add to schema**

```typescript
platform: {
  type: String,
  enum: ['x', 'threads'],
  default: 'x',
  required: true
},
```

- [ ] **Step 3: Add indexes for worker queries**

```typescript
taskSchema.index({ platform: 1, status: 1 });
taskSchema.index({ type: 1, platform: 1 });
```

- [ ] **Step 4: Commit**

```bash
git add src/db/models/Task.ts
git commit -m "feat: add platform field to Task schema"
```

---

### Task 1.3: Create Migration Script

**Files:**
- Create: `src/migrations/001_add_platform_field.ts`
- Create: `src/scripts/migrateToMultiPlatform.ts`

- [ ] **Step 1: Create migration file**

```typescript
import { TopicConfig } from "../db/models/TopicConfig.js";
import { Task } from "../db/models/Task.js";
import { log } from "../utils/logger.js";

export async function migrateToMultiPlatform() {
  log("Starting platform field migration...", "info");

  try {
    const topicResult = await TopicConfig.updateMany(
      { platform: { $exists: false } },
      { $set: { platform: 'x' } }
    );
    log(`Migrated ${topicResult.modifiedCount} TopicConfigs to platform='x'`, "info");

    const taskResult = await Task.updateMany(
      { platform: { $exists: false } },
      { $set: { platform: 'x' } }
    );
    log(`Migrated ${taskResult.modifiedCount} Tasks to platform='x'`, "info");

    log("Migration complete!", "info");
  } catch (error) {
    log(`Migration failed: ${error}`, "error");
    throw error;
  }
}
```

- [ ] **Step 2: Create migration runner**

```typescript
// src/scripts/migrateToMultiPlatform.ts
import { connectDB } from "../db/connection.js";
import { migrateToMultiPlatform } from "../migrations/001_add_platform_field.js";

async function main() {
  try {
    await connectDB();
    await migrateToMultiPlatform();
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 3: Add to package.json scripts**

```json
"migrate": "tsx src/scripts/migrateToMultiPlatform.ts"
```

- [ ] **Step 4: Commit**

```bash
git add src/migrations/001_add_platform_field.ts src/scripts/migrateToMultiPlatform.ts package.json
git commit -m "feat: add migration scripts for platform field"
```

---

## Phase 2: Platform Adapter Architecture (2-3 hours)

### Task 2.1: Create PlatformAdapter Interface

**Files:**
- Create: `src/integrations/platformAdapter.ts`

- [ ] **Step 1: Write interface**

```typescript
export interface PlatformAdapter {
  createPost(content: string, schedule?: Date): Promise<{ postId: string }>;
  replyToThread(threadId: string, content: string): Promise<{ replyId: string }>;
  scrapeNotifications(): Promise<any[]>;
  scrapeTopicPosts(keywords: string[]): Promise<any[]>;
  likePost(postId: string): Promise<void>;
  bookmarkPost(postId: string): Promise<void>;
  getEngagementMetrics(postId: string): Promise<any>;
  validateCredentials(): Promise<boolean>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/integrations/platformAdapter.ts
git commit -m "feat: add PlatformAdapter interface"
```

---

### Task 2.2: Create XAdapter

**Files:**
- Create: `src/integrations/xAdapter.ts`

- [ ] **Step 1: Implement XAdapter (creates X Tasks)**

```typescript
import { PlatformAdapter } from "./platformAdapter.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";

export class XAdapter implements PlatformAdapter {
  constructor(private credentials: { email: string; password: string }) {}

  async createPost(content: string, schedule?: Date): Promise<{ postId: string }> {
    const task = new Task({
      type: ETaskType.CREATE_POST,
      platform: "x",
      message: JSON.stringify({ content, schedule }),
      status: ETaskStatus.PENDING,
    });
    const saved = await task.save();
    return { postId: String(saved._id) };
  }

  async replyToThread(threadId: string, content: string): Promise<{ replyId: string }> {
    const task = new Task({
      type: ETaskType.REPLY,
      platform: "x",
      message: JSON.stringify({ threadId, content }),
      status: ETaskStatus.PENDING,
    });
    const saved = await task.save();
    return { replyId: String(saved._id) };
  }

  async scrapeNotifications(): Promise<any[]> {
    const task = new Task({
      type: ETaskType.SCRAPE,
      platform: "x",
      message: JSON.stringify({ type: "notifications" }),
      status: ETaskStatus.PENDING,
    });
    await task.save();
    return [];
  }

  async scrapeTopicPosts(keywords: string[]): Promise<any[]> {
    const task = new Task({
      type: ETaskType.SCRAPE,
      platform: "x",
      message: JSON.stringify({ type: "topic_posts", keywords }),
      status: ETaskStatus.PENDING,
    });
    await task.save();
    return [];
  }

  async likePost(postId: string): Promise<void> {
    const task = new Task({
      type: ETaskType.LIKE,
      platform: "x",
      message: JSON.stringify({ postId }),
      status: ETaskStatus.PENDING,
    });
    await task.save();
  }

  async bookmarkPost(postId: string): Promise<void> {
    const task = new Task({
      type: ETaskType.BOOKMARK,
      platform: "x",
      message: JSON.stringify({ postId }),
      status: ETaskStatus.PENDING,
    });
    await task.save();
  }

  async getEngagementMetrics(postId: string): Promise<any> {
    return { likes: 0, replies: 0, reposts: 0, views: 0 };
  }

  async validateCredentials(): Promise<boolean> {
    return !!(this.credentials.email && this.credentials.password);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/integrations/xAdapter.ts
git commit -m "feat: implement XAdapter for X platform"
```

---

### Task 2.3: Create ThreadsAdapter

**Files:**
- Create: `src/integrations/threadsAdapter.ts`

- [ ] **Step 1: Implement ThreadsAdapter (identical to XAdapter but platform='threads')**

```typescript
import { PlatformAdapter } from "./platformAdapter.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";

export class ThreadsAdapter implements PlatformAdapter {
  constructor(private credentials: { email: string; password: string }) {}

  async createPost(content: string, schedule?: Date): Promise<{ postId: string }> {
    const task = new Task({
      type: ETaskType.CREATE_POST,
      platform: "threads",  // ONLY DIFFERENCE: platform='threads'
      message: JSON.stringify({ content, schedule }),
      status: ETaskStatus.PENDING,
    });
    const saved = await task.save();
    return { postId: String(saved._id) };
  }

  // ... rest identical to XAdapter but with platform: "threads" ...
  
  async replyToThread(threadId: string, content: string): Promise<{ replyId: string }> {
    const task = new Task({
      type: ETaskType.REPLY,
      platform: "threads",
      message: JSON.stringify({ threadId, content }),
      status: ETaskStatus.PENDING,
    });
    const saved = await task.save();
    return { replyId: String(saved._id) };
  }

  // ... rest of methods with platform: "threads" ...
}
```

- [ ] **Step 2: Commit**

```bash
git add src/integrations/threadsAdapter.ts
git commit -m "feat: implement ThreadsAdapter for Threads platform"
```

---

### Task 2.4: Create Adapter Factory

**Files:**
- Create: `src/integrations/adapterFactory.ts`
- Create: `src/integrations/index.ts`

- [ ] **Step 1: Write factory**

```typescript
import { PlatformAdapter } from "./platformAdapter.js";
import { XAdapter } from "./xAdapter.js";
import { ThreadsAdapter } from "./threadsAdapter.js";

export function getPlatformAdapter(
  platform: "x" | "threads",
  credentials: { email: string; password: string }
): PlatformAdapter {
  switch (platform) {
    case "x": return new XAdapter(credentials);
    case "threads": return new ThreadsAdapter(credentials);
    default: throw new Error(`Unknown platform: ${platform}`);
  }
}
```

- [ ] **Step 2: Create barrel export**

```typescript
// src/integrations/index.ts
export { getPlatformAdapter, type PlatformAdapter } from "./adapterFactory.js";
```

- [ ] **Step 3: Commit**

```bash
git add src/integrations/adapterFactory.ts src/integrations/index.ts
git commit -m "feat: add adapter factory and exports"
```

---

## Phase 3: Service Refactoring (2-3 hours)

### Task 3.1: Update TopicConfigService

**Files:**
- Modify: `src/services/topicConfigService.ts`

- [ ] **Step 1: Add getPlatformCredentials function**

```typescript
export async function getPlatformCredentials(
  topicConfig: ITopicConfig | null,
  platform: "x" | "threads"
): Promise<{ email: string; password: string }> {
  if (platform === "x") {
    const xEmail = process.env.X_EMAIL || "";
    const xPassword = process.env.X_PASSWORD || "";
    if (!xEmail || !xPassword) {
      throw new Error("X credentials not configured");
    }
    return { email: xEmail, password: xPassword };
  }

  if (platform === "threads") {
    if (!topicConfig?.threads_email || !topicConfig?.threads_password) {
      throw new Error("Threads credentials not configured in TopicConfig");
    }
    return { email: topicConfig.threads_email, password: topicConfig.threads_password };
  }

  throw new Error(`Unknown platform: ${platform}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/topicConfigService.ts
git commit -m "feat: add getPlatformCredentials to topicConfigService"
```

---

### Task 3.2: Update SchedulerPrompts

**Files:**
- Modify: `src/services/schedulerPrompts.ts`

- [ ] **Step 1: Add platform parameter to all builders**

Update each function signature:
```typescript
export function buildResearchPrompt(
  role: RoleConfig,
  api: string,
  platform: "x" | "threads" = "x"
): string {
  const platformName = platform === "x" ? "X" : "Threads";
  const toneAdjustment = role.tone_override?.[platform]
    ? `\nTone for ${platformName}: ${role.tone_override[platform]}`
    : "";
  return `Research ${role.topics.join(", ")} on ${platformName}...${toneAdjustment}`;
}

// Same for buildDraftPrompt, buildReplyPrompt, buildInteractPrompt
```

- [ ] **Step 2: Commit**

```bash
git add src/services/schedulerPrompts.ts
git commit -m "feat: add platform parameter to prompt builders"
```

---

### Task 3.3: Update SchedulerService

**Files:**
- Modify: `src/services/schedulerService.ts`

- [ ] **Step 1: Update buildCronJobs to be platform-aware**

```typescript
async function buildCronJobs(): Promise<CronJob[]> {
  const role = await getActiveRoleConfig();
  const topicConfig = await TopicConfig.findOne({ is_active: true });
  const platform = topicConfig?.platform || "x";

  const researchPrompt = buildResearchPrompt(role, API, platform);
  const draftPrompt = buildDraftPrompt(role, API, platform);
  const replyPrompt = buildReplyPrompt(role, API, platform);
  const interactPrompt = buildInteractPrompt(role, API, platform);

  const topicSuffix = role.name?.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase() || "default";
  const platformSuffix = platform;

  return [
    {
      name: `scrape_notifications_${platformSuffix}_${topicSuffix}`,
      schedule: "20 * * * *",
      message: SCRAPE_PROMPT,
      platform,
      description: `Scrape ${platform} notifications (every hour at :20)`,
    },
    {
      name: `reply_notifications_${platformSuffix}_${topicSuffix}`,
      schedule: "40 * * * *",
      message: replyPrompt,
      platform,
      description: `Auto-reply on ${platform} (every hour at :40)`,
    },
    // ... add platform to all other jobs ...
  ];
}
```

- [ ] **Step 2: Update CronJob interface**

```typescript
interface CronJob {
  name: string;
  schedule: string;
  message: string;
  description: string;
  platform: "x" | "threads";  // NEW
}
```

- [ ] **Step 3: Update createCronJob to store platform**

```typescript
async function createCronJob(job: CronJob): Promise<void> {
  const task = new Task({
    type: job.name as ETaskType,
    platform: job.platform,  // NEW
    status: ETaskStatus.PENDING,
    message: job.message,
    created_at: new Date(),
  });
  await task.save();
}
```

- [ ] **Step 4: Commit**

```bash
git add src/services/schedulerService.ts
git commit -m "feat: make schedulerService platform-aware"
```

---

## Phase 4: Update Routes (1-2 hours)

### Task 4.1: Update Scheduler Routes

**Files:**
- Modify: `src/routes/scheduler.ts`

- [ ] **Step 1: Add imports**

```typescript
import { getPlatformAdapter } from "../integrations/index.js";
import { getPlatformCredentials } from "../services/topicConfigService.js";
```

- [ ] **Step 2: Update POST /post endpoint**

```typescript
router.post("/post", async (req, res) => {
  try {
    const { content, schedule, topicConfigId, platform: requestPlatform } = req.body;

    let topicConfig = topicConfigId
      ? await TopicConfig.findById(topicConfigId)
      : await TopicConfig.findOne({ is_active: true });

    if (!topicConfig) {
      return res.status(404).json({ error: "TopicConfig not found" });
    }

    const platform = requestPlatform || topicConfig.platform || "x";

    if (!["x", "threads"].includes(platform)) {
      return res.status(400).json({ error: 'Platform must be "x" or "threads"' });
    }

    const credentials = await getPlatformCredentials(topicConfig, platform);
    const adapter = getPlatformAdapter(platform, credentials);
    const result = await adapter.createPost(content, schedule);

    res.json({ success: true, postId: result.postId, platform });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});
```

- [ ] **Step 3: Do the same for POST /reply endpoint**

- [ ] **Step 4: Add TopicConfig import**

```typescript
import { TopicConfig } from "../db/models/TopicConfig.js";
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/scheduler.ts
git commit -m "feat: update scheduler routes for multi-platform"
```

---

### Task 4.2: Update TopicConfig Routes

**Files:**
- Modify: `src/routes/topicConfig.ts`

- [ ] **Step 1: Update POST handler**

Add to request destructuring:
```typescript
const { name, platform = "x", threads_email, threads_password, tone_override, ... } = req.body;

// Validate platform
if (!["x", "threads"].includes(platform)) {
  return res.status(400).json({ error: 'Platform must be "x" or "threads"' });
}

const config = new TopicConfig({
  name,
  platform,
  threads_email: threads_email || "",
  threads_password: threads_password || "",
  tone_override: tone_override || {},
  // ... other fields ...
});
```

- [ ] **Step 2: Update PATCH handler**

Handle platform updates in update logic.

- [ ] **Step 3: Commit**

```bash
git add src/routes/topicConfig.ts
git commit -m "feat: update topicConfig routes for platform fields"
```

---

## Phase 5: Testing & Validation (2-3 hours)

### Task 5.1: Write Adapter Tests

**Files:**
- Create: `src/tests/adapters.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { test, expect, describe, beforeEach } from "vitest";
import { XAdapter } from "../integrations/xAdapter.js";
import { ThreadsAdapter } from "../integrations/threadsAdapter.js";
import { getPlatformAdapter } from "../integrations/adapterFactory.js";
import { Task } from "../db/models/Task.js";

describe("Adapters", () => {
  const creds = { email: "test@example.com", password: "pass" };

  beforeEach(async () => {
    await Task.deleteMany({});
  });

  test("XAdapter creates Task with platform=x", async () => {
    const adapter = new XAdapter(creds);
    const result = await adapter.createPost("Test");
    const task = await Task.findById(result.postId);
    expect(task?.platform).toBe("x");
  });

  test("ThreadsAdapter creates Task with platform=threads", async () => {
    const adapter = new ThreadsAdapter(creds);
    const result = await adapter.createPost("Test");
    const task = await Task.findById(result.postId);
    expect(task?.platform).toBe("threads");
  });

  test("getPlatformAdapter returns correct adapter", () => {
    expect(getPlatformAdapter("x", creds)).toBeInstanceOf(XAdapter);
    expect(getPlatformAdapter("threads", creds)).toBeInstanceOf(ThreadsAdapter);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run test src/tests/adapters.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/tests/adapters.test.ts
git commit -m "test: add adapter tests"
```

---

### Task 5.2: Write Service Tests

**Files:**
- Create: `src/tests/schedulerService.platform.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { test, expect, describe, beforeEach } from "vitest";
import { TopicConfig } from "../db/models/TopicConfig.js";
import { buildCronJobs } from "../services/schedulerService.js";

describe("SchedulerService Platform Support", () => {
  beforeEach(async () => {
    await TopicConfig.deleteMany({});
  });

  test("buildCronJobs respects X platform", async () => {
    await TopicConfig.create({
      name: "XBot",
      platform: "x",
      is_active: true,
      brand: "Brand",
      persona: "Persona",
      tone: "casual",
    });

    const jobs = await buildCronJobs();
    jobs.forEach(job => {
      expect(job.platform).toBe("x");
      expect(job.name).toContain("_x_");
    });
  });

  test("buildCronJobs respects Threads platform", async () => {
    await TopicConfig.create({
      name: "ThreadsBot",
      platform: "threads",
      is_active: true,
      brand: "Brand",
      persona: "Persona",
      tone: "friendly",
      threads_email: "test@threads.com",
      threads_password: "pass",
    });

    const jobs = await buildCronJobs();
    jobs.forEach(job => {
      expect(job.platform).toBe("threads");
      expect(job.name).toContain("_threads_");
    });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run test src/tests/schedulerService.platform.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/tests/schedulerService.platform.test.ts
git commit -m "test: add scheduler service platform tests"
```

---

## Phase 6: Migration & Final Steps (1-2 hours)

### Task 6.1: Run Migration

- [ ] **Step 1: Execute migration**

```bash
npm run migrate
```

Expected output:
```
Starting platform field migration...
Migrated X TopicConfigs to platform='x'
Migrated Y Tasks to platform='x'
Migration complete!
```

---

### Task 6.2: Run All Tests

- [ ] **Step 1: Type check**

```bash
npm run typecheck
```

- [ ] **Step 2: Build**

```bash
npm run build
```

- [ ] **Step 3: Run all tests**

```bash
npm run test
```

Expected: All pass, >80% coverage

---

### Task 6.3: Final Validation

- [ ] **Step 1: Start dev server**

```bash
npm run dev &
```

- [ ] **Step 2: Create Threads TopicConfig**

```bash
curl -X POST http://localhost:3000/api/topic-config \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ThreadsBot",
    "platform": "threads",
    "brand": "MyBrand",
    "persona": "MyPersona",
    "tone": "friendly",
    "threads_email": "bot@threads.com",
    "threads_password": "password123"
  }'
```

Expected: 201 with new config

- [ ] **Step 3: Create post via Threads**

```bash
curl -X POST http://localhost:3000/api/scheduler/post \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Test post",
    "platform": "threads"
  }'
```

Expected: 200 with `postId` and `platform: "threads"`

- [ ] **Step 4: Verify Task in MongoDB**

```bash
# Connect to MongoDB and check:
db.tasks.findOne({ platform: "threads" })
# Should exist with platform: "threads"
```

- [ ] **Step 5: Stop dev server**

```bash
pkill -f "tsx watch src/index.ts"
```

---

## Summary of Commits

By completion, you should have these 13 commits:

1. `feat: add platform fields to TopicConfig schema`
2. `feat: add platform field to Task schema`
3. `feat: add migration scripts for platform field`
4. `feat: add PlatformAdapter interface`
5. `feat: implement XAdapter for X platform`
6. `feat: implement ThreadsAdapter for Threads platform`
7. `feat: add adapter factory and exports`
8. `feat: add getPlatformCredentials to topicConfigService`
9. `feat: add platform parameter to prompt builders`
10. `feat: make schedulerService platform-aware`
11. `feat: update scheduler routes for multi-platform`
12. `feat: update topicConfig routes for platform fields`
13. `test: add adapter and service tests`

---

## Key Differences from Original Plan

✅ **Removed:**
- Phase 5 (threads-worker service) — Server-side cinee-worker handles it
- All OpenClaw execution code — That's server responsibility
- Executor and handler modules

✅ **Kept:**
- Data model updates
- Platform adapters (simplified to just create Tasks)
- Service refactoring
- Routes updates
- Tests
- Migration

✅ **Result:** Simpler, 8-12 hour implementation focusing only on cinee-pipeline Task creation

---

## Architecture After Implementation

```
cinee-pipeline (this repo)
    ├─ TopicConfig.platform = 'x' or 'threads'
    ├─ PlatformAdapter (creates Tasks with platform field)
    └─ Services (use adapters)
           ↓
    MongoDB Tasks (with platform field)
           ↓
    Server-side cinee-worker
           ├─ Polls for platform='x' tasks → executes X OpenClaw commands
           └─ Polls for platform='threads' tasks → executes Threads OpenClaw commands
```

---

**Plan Complete: 8-12 hours, 13 commits, 5 phases (no separate worker service)**

Ready to proceed?
