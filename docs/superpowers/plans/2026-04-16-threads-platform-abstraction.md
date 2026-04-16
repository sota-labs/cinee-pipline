# Threads Platform Abstraction Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend cinee-pipeline X.com automation to support Meta's Threads platform using a pluggable platform abstraction layer, allowing per-bot platform selection.

**Architecture:** TopicConfig gains a `platform: 'x' | 'threads'` field. Services become platform-agnostic by delegating to PlatformAdapter implementations (XAdapter, ThreadsAdapter). Each adapter implements the same interface (post, reply, scrape, etc.). A separate `threads-worker` service polls for Threads tasks while existing `cinee-worker` handles X tasks. Prompts support adaptive personas via tone overrides per platform.

**Tech Stack:** TypeScript, Express, MongoDB, Redis, OpenClaw (for both platforms), Node.js

---

## File Structure Overview

### New Files to Create
```
src/integrations/
  ├── platformAdapter.ts          # Interface defining common operations
  ├── xAdapter.ts                 # X.com implementation
  ├── threadsAdapter.ts           # Threads implementation
  └── adapterFactory.ts           # Factory to get correct adapter

threads-worker/
  ├── src/
  │   ├── index.ts                # Main entry: poll for tasks
  │   ├── executor.ts             # Execute Threads CLI commands
  │   ├── handlers/
  │   │   ├── postHandler.ts
  │   │   ├── replyHandler.ts
  │   │   ├── scrapeHandler.ts
  │   │   └── likeHandler.ts
  │   └── logger.ts
  ├── package.json
  ├── tsconfig.json
  ├── .env.example
  └── README.md

src/migrations/
  ├── 001_add_platform_field.ts   # Migration: add platform to existing records
  └── 002_add_platform_indexes.ts # Migration: add indexes for worker queries

src/scripts/
  ├── migrateToMultiPlatform.ts   # Full migration runner
  └── rollbackMultiPlatform.ts    # Rollback script

src/tests/
  ├── adapters.test.ts             # Test adapter implementations
  ├── schedulerService.platform.test.ts  # Test platform-aware scheduler
  ├── topicConfigService.test.ts   # Test platform credential handling
  └── integration/
      └── multiPlatform.e2e.test.ts # End-to-end platform tests
```

### Modified Files
```
src/db/models/
  ├── TopicConfig.ts              # Add platform, threads_email, threads_password, tone_override
  └── Task.ts                     # Add platform field

src/services/
  ├── schedulerService.ts          # Use adapters instead of hardcoded X logic
  ├── schedulerPrompts.ts          # Add platform parameter to builders
  └── topicConfigService.ts        # Add getPlatformCredentials function

src/routes/
  ├── scheduler.ts                 # Add platform query/body parameters
  └── topicConfig.ts               # Handle platform field in POST/PATCH

src/prompts/
  └── promptBuilder.ts             # Add platform parameter to all builders

src/models/ (if needed)
  ├── Post.ts                      # Add platform field (optional)
  └── Reply.ts                     # Add platform field (optional)
```

---

## Phase 1: Data Model & Schema Updates (2-3 hours)

### Task 1.1: Update TopicConfig Schema

**Files:**
- Modify: `src/db/models/TopicConfig.ts`

- [ ] **Step 1: Read current TopicConfig file to understand structure**

```bash
cat src/db/models/TopicConfig.ts
```

- [ ] **Step 2: Add platform-related fields to ITopicConfig interface**

Add to the interface definition after `human_style_level`:
```typescript
export interface ITopicConfig extends Document {
  // ... existing fields ...
  human_style_level: "mild" | "moderate" | "heavy";
  
  // NEW: Platform support
  platform: 'x' | 'threads';
  threads_email?: string;
  threads_password?: string;
  tone_override?: {
    x?: string;
    threads?: string;
  };
  
  created_at: Date;
  updated_at: Date;
}
```

- [ ] **Step 3: Add schema fields for platform configuration**

Add to `topicConfigSchema` definition after `human_style_level`:
```typescript
platform: {
  type: String,
  enum: ['x', 'threads'],
  default: 'x',
  required: true
},
threads_email: {
  type: String,
  default: ""
},
threads_password: {
  type: String,
  default: ""
},
tone_override: {
  type: {
    x: String,
    threads: String
  },
  default: {}
},
```

- [ ] **Step 4: Add index for platform lookups**

Add after existing indexes (around line 66):
```typescript
topicConfigSchema.index({ platform: 1 });
topicConfigSchema.index({ is_active: 1, platform: 1 });
```

- [ ] **Step 5: Commit changes**

```bash
git add src/db/models/TopicConfig.ts
git commit -m "feat: add platform fields to TopicConfig schema"
```

---

### Task 1.2: Update Task Schema

**Files:**
- Modify: `src/db/models/Task.ts`

- [ ] **Step 1: Read current Task model**

```bash
cat src/db/models/Task.ts
```

- [ ] **Step 2: Add platform field to ITask interface**

After the existing `message` field, add:
```typescript
export interface ITask extends Document {
  // ... existing fields ...
  message: string;
  platform: 'x' | 'threads';  // NEW
  created_at: Date;
  updated_at: Date;
}
```

- [ ] **Step 3: Add platform field to schema**

Add to the schema definition:
```typescript
platform: {
  type: String,
  enum: ['x', 'threads'],
  default: 'x',
  required: true
},
```

- [ ] **Step 4: Add indexes for worker queries**

After existing indexes, add:
```typescript
taskSchema.index({ platform: 1, status: 1 });
taskSchema.index({ type: 1, platform: 1 });
```

- [ ] **Step 5: Commit**

```bash
git add src/db/models/Task.ts
git commit -m "feat: add platform field to Task schema with indexes"
```

---

### Task 1.3: Create Migration Script

**Files:**
- Create: `src/migrations/001_add_platform_field.ts`

- [ ] **Step 1: Write migration file**

```typescript
/**
 * Migration: Add platform field to TopicConfig and Task
 * Sets default platform='x' for all existing records for backward compatibility
 */
import { TopicConfig } from "../db/models/TopicConfig.js";
import { Task } from "../db/models/Task.js";
import { log } from "../utils/logger.js";
import * as dotenv from "dotenv";

dotenv.config();

export async function up() {
  log("Starting migration: add platform field...", "info");

  try {
    // Migrate TopicConfig
    const topicResult = await TopicConfig.updateMany(
      { platform: { $exists: false } },
      { $set: { platform: 'x' } }
    );
    log(
      `TopicConfig migration: updated ${topicResult.modifiedCount} records`,
      "info"
    );

    // Migrate Task
    const taskResult = await Task.updateMany(
      { platform: { $exists: false } },
      { $set: { platform: 'x' } }
    );
    log(
      `Task migration: updated ${taskResult.modifiedCount} records`,
      "info"
    );

    log("Migration complete!", "info");
  } catch (error) {
    log(`Migration failed: ${error}`, "error");
    throw error;
  }
}

export async function down() {
  log("Rolling back migration: removing platform field...", "info");

  try {
    await TopicConfig.updateMany({}, { $unset: { platform: 1 } });
    await Task.updateMany({}, { $unset: { platform: 1 } });
    log("Rollback complete!", "info");
  } catch (error) {
    log(`Rollback failed: ${error}`, "error");
    throw error;
  }
}
```

- [ ] **Step 2: Create migration runner script**

Create `src/scripts/runMigrations.ts`:
```typescript
import { connectDB } from "../db/connection.js";
import { up } from "../migrations/001_add_platform_field.js";
import { log } from "../utils/logger.js";

async function main() {
  try {
    await connectDB();
    log("Database connected", "info");

    await up();
    log("All migrations completed successfully", "info");

    process.exit(0);
  } catch (error) {
    log(`Migration error: ${error}`, "error");
    process.exit(1);
  }
}

main();
```

- [ ] **Step 3: Add migration script to package.json**

In `package.json`, add to scripts section:
```json
"migrate": "tsx src/scripts/runMigrations.ts"
```

- [ ] **Step 4: Commit**

```bash
git add src/migrations/001_add_platform_field.ts src/scripts/runMigrations.ts package.json
git commit -m "feat: add migration scripts for platform field"
```

---

## Phase 2: Platform Adapter Architecture (3-4 hours)

### Task 2.1: Create PlatformAdapter Interface

**Files:**
- Create: `src/integrations/platformAdapter.ts`

- [ ] **Step 1: Write interface definition**

```typescript
/**
 * PlatformAdapter interface — defines operations all platforms must support
 */
export interface PlatformAdapter {
  /**
   * Create a new post on the platform
   */
  createPost(content: string, schedule?: Date): Promise<{
    postId: string;
    scheduledAt?: Date;
  }>;

  /**
   * Reply to a thread on the platform
   */
  replyToThread(threadId: string, content: string): Promise<{
    replyId: string;
  }>;

  /**
   * Scrape notifications (mentions, replies, likes)
   */
  scrapeNotifications(): Promise<
    Array<{
      id: string;
      type: "mention" | "reply" | "like";
      content: string;
      authorId: string;
      timestamp: Date;
    }>
  >;

  /**
   * Scrape posts matching keywords from the platform
   */
  scrapeTopicPosts(keywords: string[]): Promise<
    Array<{
      id: string;
      content: string;
      author: string;
      likes: number;
      replies: number;
      timestamp: Date;
    }>
  >;

  /**
   * Like a post
   */
  likePost(postId: string): Promise<void>;

  /**
   * Bookmark a post
   */
  bookmarkPost(postId: string): Promise<void>;

  /**
   * Get engagement metrics for a post
   */
  getEngagementMetrics(postId: string): Promise<{
    likes: number;
    replies: number;
    reposts: number;
    views: number;
  }>;

  /**
   * Validate that credentials are valid
   */
  validateCredentials(): Promise<boolean>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/integrations/platformAdapter.ts
git commit -m "feat: add PlatformAdapter interface"
```

---

### Task 2.2: Create XAdapter Implementation

**Files:**
- Create: `src/integrations/xAdapter.ts`

- [ ] **Step 1: Write XAdapter class**

```typescript
/**
 * XAdapter — implements PlatformAdapter for X.com
 */
import { PlatformAdapter } from "./platformAdapter.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";
import { log } from "../utils/logger.js";

export class XAdapter implements PlatformAdapter {
  constructor(private credentials: { email: string; password: string }) {}

  async createPost(
    content: string,
    schedule?: Date
  ): Promise<{ postId: string; scheduledAt?: Date }> {
    // Create task for cinee-worker to execute
    const task = new Task({
      type: ETaskType.CREATE_POST,
      platform: "x",
      message: JSON.stringify({ content, schedule }),
      status: ETaskStatus.PENDING,
    });
    const savedTask = await task.save();

    log(`XAdapter: Created post task ${savedTask._id}`, "debug");

    return {
      postId: String(savedTask._id),
      scheduledAt: schedule,
    };
  }

  async replyToThread(
    threadId: string,
    content: string
  ): Promise<{ replyId: string }> {
    const task = new Task({
      type: ETaskType.REPLY,
      platform: "x",
      message: JSON.stringify({ threadId, content }),
      status: ETaskStatus.PENDING,
    });
    const savedTask = await task.save();

    log(`XAdapter: Created reply task ${savedTask._id}`, "debug");

    return { replyId: String(savedTask._id) };
  }

  async scrapeNotifications(): Promise<any[]> {
    // Create scrape task
    const task = new Task({
      type: ETaskType.SCRAPE,
      platform: "x",
      message: JSON.stringify({ type: "notifications" }),
      status: ETaskStatus.PENDING,
    });
    await task.save();

    // In real implementation, would wait for task completion and return results
    log("XAdapter: Scrape notifications task created", "debug");
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

    log("XAdapter: Scrape topic posts task created", "debug");
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

    log(`XAdapter: Like task created for ${postId}`, "debug");
  }

  async bookmarkPost(postId: string): Promise<void> {
    const task = new Task({
      type: ETaskType.BOOKMARK,
      platform: "x",
      message: JSON.stringify({ postId }),
      status: ETaskStatus.PENDING,
    });
    await task.save();

    log(`XAdapter: Bookmark task created for ${postId}`, "debug");
  }

  async getEngagementMetrics(postId: string): Promise<any> {
    // Would fetch from cache or API
    log(`XAdapter: Fetching metrics for ${postId}`, "debug");
    return { likes: 0, replies: 0, reposts: 0, views: 0 };
  }

  async validateCredentials(): Promise<boolean> {
    // Would attempt login to validate
    if (!this.credentials.email || !this.credentials.password) {
      return false;
    }
    return true;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/integrations/xAdapter.ts
git commit -m "feat: implement XAdapter for X.com platform"
```

---

### Task 2.3: Create ThreadsAdapter Implementation

**Files:**
- Create: `src/integrations/threadsAdapter.ts`

- [ ] **Step 1: Write ThreadsAdapter class**

```typescript
/**
 * ThreadsAdapter — implements PlatformAdapter for Meta Threads
 */
import { PlatformAdapter } from "./platformAdapter.js";
import { Task, ETaskType, ETaskStatus } from "../db/models/Task.js";
import { log } from "../utils/logger.js";

export class ThreadsAdapter implements PlatformAdapter {
  constructor(private credentials: { email: string; password: string }) {}

  async createPost(
    content: string,
    schedule?: Date
  ): Promise<{ postId: string; scheduledAt?: Date }> {
    // Create task for threads-worker to execute
    const task = new Task({
      type: ETaskType.CREATE_POST,
      platform: "threads",
      message: JSON.stringify({ content, schedule }),
      status: ETaskStatus.PENDING,
    });
    const savedTask = await task.save();

    log(`ThreadsAdapter: Created post task ${savedTask._id}`, "debug");

    return {
      postId: String(savedTask._id),
      scheduledAt: schedule,
    };
  }

  async replyToThread(
    threadId: string,
    content: string
  ): Promise<{ replyId: string }> {
    const task = new Task({
      type: ETaskType.REPLY,
      platform: "threads",
      message: JSON.stringify({ threadId, content }),
      status: ETaskStatus.PENDING,
    });
    const savedTask = await task.save();

    log(`ThreadsAdapter: Created reply task ${savedTask._id}`, "debug");

    return { replyId: String(savedTask._id) };
  }

  async scrapeNotifications(): Promise<any[]> {
    const task = new Task({
      type: ETaskType.SCRAPE,
      platform: "threads",
      message: JSON.stringify({ type: "notifications" }),
      status: ETaskStatus.PENDING,
    });
    await task.save();

    log("ThreadsAdapter: Scrape notifications task created", "debug");
    return [];
  }

  async scrapeTopicPosts(keywords: string[]): Promise<any[]> {
    const task = new Task({
      type: ETaskType.SCRAPE,
      platform: "threads",
      message: JSON.stringify({ type: "topic_posts", keywords }),
      status: ETaskStatus.PENDING,
    });
    await task.save();

    log("ThreadsAdapter: Scrape topic posts task created", "debug");
    return [];
  }

  async likePost(postId: string): Promise<void> {
    const task = new Task({
      type: ETaskType.LIKE,
      platform: "threads",
      message: JSON.stringify({ postId }),
      status: ETaskStatus.PENDING,
    });
    await task.save();

    log(`ThreadsAdapter: Like task created for ${postId}`, "debug");
  }

  async bookmarkPost(postId: string): Promise<void> {
    const task = new Task({
      type: ETaskType.BOOKMARK,
      platform: "threads",
      message: JSON.stringify({ postId }),
      status: ETaskStatus.PENDING,
    });
    await task.save();

    log(`ThreadsAdapter: Bookmark task created for ${postId}`, "debug");
  }

  async getEngagementMetrics(postId: string): Promise<any> {
    log(`ThreadsAdapter: Fetching metrics for ${postId}`, "debug");
    return { likes: 0, replies: 0, reposts: 0, views: 0 };
  }

  async validateCredentials(): Promise<boolean> {
    if (!this.credentials.email || !this.credentials.password) {
      return false;
    }
    return true;
  }
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

- [ ] **Step 1: Write factory function**

```typescript
/**
 * Factory for getting the correct PlatformAdapter instance
 */
import { PlatformAdapter } from "./platformAdapter.js";
import { XAdapter } from "./xAdapter.js";
import { ThreadsAdapter } from "./threadsAdapter.js";

export function getPlatformAdapter(
  platform: "x" | "threads",
  credentials: { email: string; password: string }
): PlatformAdapter {
  switch (platform) {
    case "x":
      return new XAdapter(credentials);
    case "threads":
      return new ThreadsAdapter(credentials);
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

export type { PlatformAdapter };
```

- [ ] **Step 2: Create barrel export**

Create `src/integrations/index.ts`:
```typescript
export { getPlatformAdapter, type PlatformAdapter } from "./adapterFactory.js";
export { XAdapter } from "./xAdapter.js";
export { ThreadsAdapter } from "./threadsAdapter.js";
```

- [ ] **Step 3: Commit**

```bash
git add src/integrations/adapterFactory.ts src/integrations/index.ts
git commit -m "feat: add adapter factory and barrel export"
```

---

## Phase 3: Service Refactoring (5-6 hours)

### Task 3.1: Update TopicConfigService

**Files:**
- Modify: `src/services/topicConfigService.ts`

- [ ] **Step 1: Read current file**

```bash
head -50 src/services/topicConfigService.ts
```

- [ ] **Step 2: Add getPlatformCredentials function**

Add before the export statements at the end:
```typescript
/**
 * Get credentials for a specific platform from TopicConfig
 */
export async function getPlatformCredentials(
  topicConfig: ITopicConfig | null,
  platform: "x" | "threads"
): Promise<{ email: string; password: string }> {
  if (platform === "x") {
    const xEmail = process.env.X_EMAIL || "";
    const xPassword = process.env.X_PASSWORD || "";

    if (!xEmail || !xPassword) {
      throw new Error("X credentials not configured in environment");
    }

    return { email: xEmail, password: xPassword };
  }

  if (platform === "threads") {
    if (!topicConfig) {
      throw new Error("TopicConfig required for Threads credentials");
    }

    const email = topicConfig.threads_email || "";
    const password = topicConfig.threads_password || "";

    if (!email || !password) {
      throw new Error("Threads credentials not configured in TopicConfig");
    }

    return { email, password };
  }

  throw new Error(`Unknown platform: ${platform}`);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/services/topicConfigService.ts
git commit -m "feat: add getPlatformCredentials to topicConfigService"
```

---

### Task 3.2: Update SchedulerPrompts

**Files:**
- Modify: `src/services/schedulerPrompts.ts`

- [ ] **Step 1: Read current file to see existing builders**

```bash
cat src/services/schedulerPrompts.ts | head -100
```

- [ ] **Step 2: Update buildResearchPrompt signature**

Find the `buildResearchPrompt` function and update it:
```typescript
export function buildResearchPrompt(
  role: RoleConfig,
  api: string,
  platform: "x" | "threads" = "x"
): string {
  const platformName = platform === "x" ? "X" : "Threads";
  const toneAdjustment = role.tone_override?.[platform]
    ? `\n\nTone adjustment for ${platformName}: ${role.tone_override[platform]}`
    : "";

  return `Research ${role.topics.join(", ")} on ${platformName}...${toneAdjustment}`;
}
```

- [ ] **Step 3: Update buildDraftPrompt signature**

```typescript
export function buildDraftPrompt(
  role: RoleConfig,
  api: string,
  platform: "x" | "threads" = "x"
): string {
  const platformName = platform === "x" ? "X" : "Threads";
  const toneAdjustment = role.tone_override?.[platform]
    ? `\n\nTone adjustment for ${platformName}: ${role.tone_override[platform]}`
    : "";

  return `Draft content for ${role.brand} on ${platformName}...${toneAdjustment}`;
}
```

- [ ] **Step 4: Update buildReplyPrompt signature**

```typescript
export function buildReplyPrompt(
  role: RoleConfig,
  api: string,
  platform: "x" | "threads" = "x"
): string {
  const platformName = platform === "x" ? "X" : "Threads";
  const toneAdjustment = role.tone_override?.[platform]
    ? `\n\nTone adjustment for ${platformName}: ${role.tone_override[platform]}`
    : "";

  return `Generate a reply for ${role.brand} on ${platformName}...${toneAdjustment}`;
}
```

- [ ] **Step 5: Update buildInteractPrompt signature**

```typescript
export function buildInteractPrompt(
  role: RoleConfig,
  api: string,
  platform: "x" | "threads" = "x"
): string {
  const platformName = platform === "x" ? "X" : "Threads";
  const toneAdjustment = role.tone_override?.[platform]
    ? `\n\nTone adjustment for ${platformName}: ${role.tone_override[platform]}`
    : "";

  return `Generate interaction comments for ${role.brand} on ${platformName}...${toneAdjustment}`;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/services/schedulerPrompts.ts
git commit -m "feat: add platform parameter to prompt builders for adaptive personas"
```

---

### Task 3.3: Update SchedulerService

**Files:**
- Modify: `src/services/schedulerService.ts`

- [ ] **Step 1: Update buildCronJobs function signature and implementation**

Replace the entire `buildCronJobs` function with:
```typescript
async function buildCronJobs(): Promise<CronJob[]> {
  const role = await getActiveRoleConfig();
  const topicConfig = await TopicConfig.findOne({ is_active: true });
  const platform = topicConfig?.platform || "x";

  const researchPrompt = buildResearchPrompt(role, API, platform);
  const draftPrompt = buildDraftPrompt(role, API, platform);
  const replyPrompt = buildReplyPrompt(role, API, platform);
  const interactPrompt = buildInteractPrompt(role, API, platform);

  const topicSuffix = role.name
    ? role.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase()
    : "default";
  const platformSuffix = platform; // 'x' or 'threads'

  return [
    {
      name: `scrape_notifications_${platformSuffix}_${topicSuffix}`,
      schedule: "20 * * * *",
      message: SCRAPE_PROMPT,
      platform, // NEW
      description: `Scrape ${platform} notifications and store replies (every hour at :20)`,
    },
    {
      name: `reply_notifications_${platformSuffix}_${topicSuffix}`,
      schedule: "40 * * * *",
      message: replyPrompt,
      platform, // NEW
      description: `Auto-reply on ${platform} and update status (every hour at :40)`,
    },
    {
      name: `research_and_collect_${platformSuffix}_${topicSuffix}`,
      schedule: "0 */6 * * *",
      message: researchPrompt,
      platform, // NEW
      description: `Scrape ${platform} for topic posts and save to CurationSource DB (every 6 hours)`,
    },
    {
      name: `research_and_draft_morning_${platformSuffix}_${topicSuffix}`,
      schedule: "0 9 * * *",
      message: draftPrompt,
      platform, // NEW
      description: `Read top research from DB and create draft for review (9 AM daily)`,
    },
    {
      name: `research_and_draft_evening_${platformSuffix}_${topicSuffix}`,
      schedule: "0 21 * * *",
      message: draftPrompt,
      platform, // NEW
      description: `Read top research from DB and create draft for review (9 PM daily)`,
    },
    {
      name: `auto_interact_hot_posts_${platformSuffix}_${topicSuffix}`,
      schedule: "0 */4 * * *",
      message: interactPrompt,
      platform, // NEW
      description: `Automatically post CEO-style comments on hot posts (every 4 hours)`,
    },
    {
      name: `auto_like_posts_${platformSuffix}_${topicSuffix}`,
      schedule: "0 10,22 * * *",
      message: AUTO_LIKE_PROMPT,
      platform, // NEW
      description: `Automatically like posts (twice daily, ~5 posts each)`,
    },
    {
      name: `auto_bookmark_posts_${platformSuffix}_${topicSuffix}`,
      schedule: "0 14 */2 * *",
      message: AUTO_BOOKMARK_PROMPT,
      platform, // NEW
      description: `Automatically bookmark a high-quality post (every 2 days)`,
    },
  ];
}
```

- [ ] **Step 2: Update CronJob interface to include platform**

Add `platform` field to the interface:
```typescript
interface CronJob {
  name: string;
  schedule: string;
  message: string;
  description: string;
  platform: "x" | "threads";  // NEW
}
```

- [ ] **Step 3: Update createCronJob to store platform in Task**

Find the `createCronJob` function and update it:
```typescript
async function createCronJob(job: CronJob): Promise<void> {
  const task = new Task({
    type: job.name as ETaskType,
    platform: job.platform,  // NEW: Store platform
    status: ETaskStatus.PENDING,
    message: job.message,
    created_at: new Date(),
  });

  await task.save();
  log(`Cron job created: ${job.name}`, "info");
}
```

- [ ] **Step 4: Add import for TopicConfig and getPlatformCredentials**

At top of file, ensure these imports exist:
```typescript
import { TopicConfig } from "../db/models/TopicConfig.js";
import { getPlatformCredentials } from "./topicConfigService.js";
```

- [ ] **Step 5: Commit**

```bash
git add src/services/schedulerService.ts
git commit -m "feat: make schedulerService platform-aware"
```

---

## Phase 4: Update Routes & API Endpoints (1-2 hours)

### Task 4.1: Update Scheduler Routes

**Files:**
- Modify: `src/routes/scheduler.ts`

- [ ] **Step 1: Read current scheduler routes**

```bash
cat src/routes/scheduler.ts | head -80
```

- [ ] **Step 2: Add imports for adapters and platform handling**

At top of file:
```typescript
import { getPlatformAdapter } from "../integrations/index.js";
import { getPlatformCredentials } from "../services/topicConfigService.js";
```

- [ ] **Step 3: Update POST /post endpoint to support platform**

Find the POST route handler and update it:
```typescript
router.post("/post", async (req, res) => {
  try {
    const {
      content,
      schedule,
      topicConfigId,
      platform: requestPlatform,
    } = req.body;

    // Get TopicConfig
    let topicConfig;
    if (topicConfigId) {
      topicConfig = await TopicConfig.findById(topicConfigId);
    } else {
      topicConfig = await TopicConfig.findOne({ is_active: true });
    }

    if (!topicConfig) {
      return res
        .status(404)
        .json({ error: "TopicConfig not found" });
    }

    // Determine platform
    const platform = requestPlatform || topicConfig.platform || "x";

    // Validate platform
    if (!["x", "threads"].includes(platform)) {
      return res
        .status(400)
        .json({ error: 'Platform must be "x" or "threads"' });
    }

    // Get credentials
    const credentials = await getPlatformCredentials(topicConfig, platform);

    // Get adapter and create post
    const adapter = getPlatformAdapter(platform, credentials);
    const result = await adapter.createPost(content, schedule);

    res.json({ success: true, postId: result.postId, platform });
  } catch (error) {
    log(`Error creating post: ${error}`, "error");
    res
      .status(500)
      .json({ error: String(error) });
  }
});
```

- [ ] **Step 4: Update POST /reply endpoint to support platform**

```typescript
router.post("/reply", async (req, res) => {
  try {
    const { threadId, content, topicConfigId, platform: requestPlatform } =
      req.body;

    if (!threadId || !content) {
      return res
        .status(400)
        .json({ error: "threadId and content required" });
    }

    let topicConfig;
    if (topicConfigId) {
      topicConfig = await TopicConfig.findById(topicConfigId);
    } else {
      topicConfig = await TopicConfig.findOne({ is_active: true });
    }

    if (!topicConfig) {
      return res
        .status(404)
        .json({ error: "TopicConfig not found" });
    }

    const platform = requestPlatform || topicConfig.platform || "x";

    if (!["x", "threads"].includes(platform)) {
      return res
        .status(400)
        .json({ error: 'Platform must be "x" or "threads"' });
    }

    const credentials = await getPlatformCredentials(topicConfig, platform);
    const adapter = getPlatformAdapter(platform, credentials);
    const result = await adapter.replyToThread(threadId, content);

    res.json({ success: true, replyId: result.replyId, platform });
  } catch (error) {
    log(`Error replying to thread: ${error}`, "error");
    res
      .status(500)
      .json({ error: String(error) });
  }
});
```

- [ ] **Step 5: Add import for TopicConfig at top**

```typescript
import { TopicConfig } from "../db/models/TopicConfig.js";
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/scheduler.ts
git commit -m "feat: update scheduler routes to support multi-platform"
```

---

### Task 4.2: Update TopicConfig Routes

**Files:**
- Modify: `src/routes/topicConfig.ts`

- [ ] **Step 1: Read current route file**

```bash
cat src/routes/topicConfig.ts | head -100
```

- [ ] **Step 2: Update POST handler to accept platform fields**

Find the POST / route handler and add to the request destructuring:
```typescript
router.post("/", async (req, res) => {
  try {
    const {
      name,
      platform = "x",  // NEW: Default to 'x'
      threads_email,   // NEW
      threads_password, // NEW
      tone_override,   // NEW
      brand,
      persona,
      tone,
      topics,
      // ... other fields ...
    } = req.body;

    // Validate platform
    if (!["x", "threads"].includes(platform)) {
      return res
        .status(400)
        .json({ error: 'Platform must be "x" or "threads"' });
    }

    const config = new TopicConfig({
      name,
      platform,
      threads_email: threads_email || "",
      threads_password: threads_password || "",
      tone_override: tone_override || {},
      brand,
      persona,
      tone,
      topics: topics || [],
      // ... other fields ...
    });

    await config.save();
    res.json(config);
  } catch (error) {
    log(`Error creating TopicConfig: ${error}`, "error");
    res
      .status(500)
      .json({ error: String(error) });
  }
});
```

- [ ] **Step 3: Update PATCH handler**

Find the PATCH /:id route and update to handle platform fields:
```typescript
router.patch("/:id", async (req, res) => {
  try {
    const { platform, threads_email, threads_password, tone_override, ... } =
      req.body;

    // Validate platform if provided
    if (platform && !["x", "threads"].includes(platform)) {
      return res
        .status(400)
        .json({ error: 'Platform must be "x" or "threads"' });
    }

    const updates: any = {};
    if (platform) updates.platform = platform;
    if (threads_email !== undefined) updates.threads_email = threads_email;
    if (threads_password !== undefined)
      updates.threads_password = threads_password;
    if (tone_override !== undefined) updates.tone_override = tone_override;
    // ... add other fields ...

    const config = await TopicConfig.findByIdAndUpdate(req.params.id, updates, {
      new: true,
    });

    if (!config) {
      return res.status(404).json({ error: "TopicConfig not found" });
    }

    res.json(config);
  } catch (error) {
    log(`Error updating TopicConfig: ${error}`, "error");
    res
      .status(500)
      .json({ error: String(error) });
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/topicConfig.ts
git commit -m "feat: update topicConfig routes to handle platform fields"
```

---

## Phase 5: Create Threads Worker Service (3-4 hours)

### Task 5.1: Create Threads Worker Directory & Package

**Files:**
- Create: `threads-worker/package.json`
- Create: `threads-worker/tsconfig.json`
- Create: `threads-worker/.env.example`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "threads-worker",
  "version": "1.0.0",
  "description": "Worker service for executing Threads automation tasks",
  "main": "dist/index.js",
  "type": "module",
  "scripts": {
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@types/node": "^22.0.0",
    "dotenv": "^16.4.0",
    "mongodb": "^6.3.0",
    "typescript": "^5.6.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create .env.example**

```bash
# MongoDB connection
MONGODB_URI=mongodb://localhost:27017/cinee

# Threads credentials (from TopicConfig in DB)
THREADS_EMAIL=user@threads.com
THREADS_PASSWORD=password

# Logging
LOG_LEVEL=info

# Worker polling
POLL_INTERVAL=5000
MAX_RETRIES=3
```

- [ ] **Step 4: Commit**

```bash
mkdir -p threads-worker
git add threads-worker/package.json threads-worker/tsconfig.json threads-worker/.env.example
git commit -m "feat: create threads-worker project structure"
```

---

### Task 5.2: Create Threads Worker Logger

**Files:**
- Create: `threads-worker/src/logger.ts`

- [ ] **Step 1: Create logger utility**

```typescript
/**
 * Simple logger for threads-worker
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel =
  (process.env.LOG_LEVEL as LogLevel) || "info";

export function log(message: string, level: LogLevel = "info") {
  const timestamp = new Date().toISOString();
  const levelUpper = level.toUpperCase();

  if (LEVELS[level] >= LEVELS[currentLevel]) {
    console.log(`[${timestamp}] [${levelUpper}] ${message}`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add threads-worker/src/logger.ts
git commit -m "feat: add logger to threads-worker"
```

---

### Task 5.3: Create Threads Worker Main Entry Point

**Files:**
- Create: `threads-worker/src/index.ts`

- [ ] **Step 1: Create main worker entry**

```typescript
/**
 * Threads Worker — polls MongoDB for Threads tasks and executes them
 */

import { MongoClient, Db } from "mongodb";
import * as dotenv from "dotenv";
import { log } from "./logger.js";
import { executeTask } from "./executor.js";

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/cinee";
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "5000", 10);

let db: Db;
let isRunning = true;

async function main() {
  try {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db("cinee");

    log("Threads Worker started", "info");
    log(`Polling interval: ${POLL_INTERVAL}ms`, "info");

    // Start polling loop
    await pollForTasks();
  } catch (error) {
    log(`Worker error: ${error}`, "error");
    process.exit(1);
  }
}

async function pollForTasks() {
  while (isRunning) {
    try {
      // Query for next pending Threads task
      const task = await db
        .collection("tasks")
        .findOne({
          platform: "threads",
          status: "PENDING",
        });

      if (task) {
        log(`Found task: ${task._id} (${task.type})`, "debug");
        await executeTask(db, task);
      } else {
        // No tasks, wait before next poll
        await sleep(POLL_INTERVAL);
      }
    } catch (error) {
      log(`Poll error: ${error}`, "error");
      await sleep(POLL_INTERVAL);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  log("Shutdown signal received", "info");
  isRunning = false;
  process.exit(0);
});

main().catch((error) => {
  log(`Fatal error: ${error}`, "error");
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add threads-worker/src/index.ts
git commit -m "feat: create threads-worker main entry point"
```

---

### Task 5.4: Create Threads Worker Executor

**Files:**
- Create: `threads-worker/src/executor.ts`

- [ ] **Step 1: Create executor module**

```typescript
/**
 * Executor — handles task execution and status updates
 */

import { Db, ObjectId } from "mongodb";
import { log } from "./logger.js";

export async function executeTask(db: Db, task: any) {
  const taskId = task._id;
  const taskType = task.type;

  try {
    log(`Executing task: ${taskId} (${taskType})`, "info");

    // Parse message
    let payload: any = {};
    try {
      payload = JSON.parse(task.message);
    } catch (e) {
      log(`Invalid JSON in task message: ${task.message}`, "warn");
    }

    // Route to appropriate handler
    switch (taskType) {
      case "CREATE_POST":
        await handleCreatePost(db, task, payload);
        break;

      case "REPLY":
        await handleReply(db, task, payload);
        break;

      case "SCRAPE":
        await handleScrape(db, task, payload);
        break;

      case "LIKE":
        await handleLike(db, task, payload);
        break;

      case "BOOKMARK":
        await handleBookmark(db, task, payload);
        break;

      default:
        throw new Error(`Unknown task type: ${taskType}`);
    }

    // Mark as completed
    await db.collection("tasks").updateOne(
      { _id: taskId },
      {
        $set: {
          status: "COMPLETED",
          updated_at: new Date(),
        },
      }
    );

    log(`Task completed: ${taskId}`, "info");
  } catch (error) {
    log(`Task failed: ${taskId} - ${error}`, "error");

    // Mark as failed
    await db.collection("tasks").updateOne(
      { _id: taskId },
      {
        $set: {
          status: "FAILED",
          error: String(error),
          updated_at: new Date(),
        },
      }
    );
  }
}

async function handleCreatePost(db: Db, task: any, payload: any) {
  const { content, schedule } = payload;
  log(`Creating post: ${content.substring(0, 50)}...`, "debug");

  // TODO: Execute OpenClaw command to create post on Threads
  // For now, just log that we would execute
  log("Would execute: openclaw post-threads", "debug");
}

async function handleReply(db: Db, task: any, payload: any) {
  const { threadId, content } = payload;
  log(`Replying to thread: ${threadId}`, "debug");

  // TODO: Execute OpenClaw command to reply on Threads
  log("Would execute: openclaw reply-threads", "debug");
}

async function handleScrape(db: Db, task: any, payload: any) {
  const { type, keywords } = payload;
  log(`Scraping ${type} on Threads`, "debug");

  // TODO: Execute OpenClaw command to scrape Threads
  log("Would execute: openclaw scrape-threads", "debug");
}

async function handleLike(db: Db, task: any, payload: any) {
  const { postId } = payload;
  log(`Liking post: ${postId}`, "debug");

  // TODO: Execute OpenClaw command to like on Threads
  log("Would execute: openclaw like-threads", "debug");
}

async function handleBookmark(db: Db, task: any, payload: any) {
  const { postId } = payload;
  log(`Bookmarking post: ${postId}`, "debug");

  // TODO: Execute OpenClaw command to bookmark on Threads
  log("Would execute: openclaw bookmark-threads", "debug");
}
```

- [ ] **Step 2: Commit**

```bash
git add threads-worker/src/executor.ts
git commit -m "feat: create threads-worker task executor"
```

---

## Phase 6: Testing & Validation (3-4 hours)

### Task 6.1: Write Adapter Tests

**Files:**
- Create: `src/tests/adapters.test.ts`

- [ ] **Step 1: Write test file**

```typescript
/**
 * Tests for PlatformAdapter implementations
 */
import { test, expect, describe, beforeEach, afterEach } from "vitest";
import { XAdapter } from "../integrations/xAdapter.js";
import { ThreadsAdapter } from "../integrations/threadsAdapter.js";
import { getPlatformAdapter } from "../integrations/adapterFactory.js";
import { Task } from "../db/models/Task.js";

describe("PlatformAdapters", () => {
  const credentials = {
    email: "test@example.com",
    password: "password123",
  };

  beforeEach(async () => {
    // Clear tasks before each test
    await Task.deleteMany({});
  });

  describe("XAdapter", () => {
    test("XAdapter implements PlatformAdapter interface", () => {
      const adapter = new XAdapter(credentials);
      expect(adapter.createPost).toBeDefined();
      expect(adapter.replyToThread).toBeDefined();
      expect(adapter.scrapeNotifications).toBeDefined();
      expect(adapter.scrapeTopicPosts).toBeDefined();
      expect(adapter.likePost).toBeDefined();
      expect(adapter.bookmarkPost).toBeDefined();
      expect(adapter.getEngagementMetrics).toBeDefined();
      expect(adapter.validateCredentials).toBeDefined();
    });

    test("XAdapter.createPost creates Task record with platform=x", async () => {
      const adapter = new XAdapter(credentials);
      const result = await adapter.createPost("Test post");

      expect(result.postId).toBeDefined();

      const task = await Task.findById(result.postId);
      expect(task).toBeDefined();
      expect(task?.platform).toBe("x");
    });

    test("XAdapter.validateCredentials returns false when credentials missing", async () => {
      const adapter = new XAdapter({ email: "", password: "" });
      const valid = await adapter.validateCredentials();
      expect(valid).toBe(false);
    });
  });

  describe("ThreadsAdapter", () => {
    test("ThreadsAdapter implements PlatformAdapter interface", () => {
      const adapter = new ThreadsAdapter(credentials);
      expect(adapter.createPost).toBeDefined();
      expect(adapter.replyToThread).toBeDefined();
      expect(adapter.scrapeNotifications).toBeDefined();
      expect(adapter.scrapeTopicPosts).toBeDefined();
      expect(adapter.likePost).toBeDefined();
      expect(adapter.bookmarkPost).toBeDefined();
      expect(adapter.getEngagementMetrics).toBeDefined();
      expect(adapter.validateCredentials).toBeDefined();
    });

    test("ThreadsAdapter.createPost creates Task record with platform=threads", async () => {
      const adapter = new ThreadsAdapter(credentials);
      const result = await adapter.createPost("Test post");

      expect(result.postId).toBeDefined();

      const task = await Task.findById(result.postId);
      expect(task).toBeDefined();
      expect(task?.platform).toBe("threads");
    });
  });

  describe("AdapterFactory", () => {
    test("getPlatformAdapter returns XAdapter for platform=x", () => {
      const adapter = getPlatformAdapter("x", credentials);
      expect(adapter).toBeInstanceOf(XAdapter);
    });

    test("getPlatformAdapter returns ThreadsAdapter for platform=threads", () => {
      const adapter = getPlatformAdapter("threads", credentials);
      expect(adapter).toBeInstanceOf(ThreadsAdapter);
    });

    test("getPlatformAdapter throws error for unknown platform", () => {
      expect(() => {
        getPlatformAdapter("unknown" as any, credentials);
      }).toThrow("Unknown platform: unknown");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
npm run test src/tests/adapters.test.ts
```

Expected: All tests should PASS

- [ ] **Step 3: Commit**

```bash
git add src/tests/adapters.test.ts
git commit -m "test: add adapter implementation tests"
```

---

### Task 6.2: Write SchedulerService Tests

**Files:**
- Create: `src/tests/schedulerService.platform.test.ts`

- [ ] **Step 1: Write test file**

```typescript
/**
 * Tests for platform-aware scheduler service
 */
import { test, expect, describe, beforeEach } from "vitest";
import { TopicConfig } from "../db/models/TopicConfig.js";
import { Task } from "../db/models/Task.js";
import { buildCronJobs } from "../services/schedulerService.js";

describe("SchedulerService Multi-Platform", () => {
  beforeEach(async () => {
    // Clean up before each test
    await TopicConfig.deleteMany({});
    await Task.deleteMany({});
  });

  test("buildCronJobs respects platform from active TopicConfig (X)", async () => {
    // Create X config
    const xConfig = await TopicConfig.create({
      name: "TestXConfig",
      platform: "x",
      is_active: true,
      brand: "TestBrand",
      persona: "TestPersona",
      tone: "casual",
    });

    const jobs = await buildCronJobs();

    // Jobs should have _x_ in their names
    const xJobs = jobs.filter((j) => j.name.includes("_x_"));
    expect(xJobs.length).toBeGreaterThan(0);

    // All jobs should have platform: x
    jobs.forEach((job) => {
      if (job.name.includes("_x_")) {
        expect(job.platform).toBe("x");
      }
    });
  });

  test("buildCronJobs respects platform from active TopicConfig (Threads)", async () => {
    // Create Threads config
    const threadsConfig = await TopicConfig.create({
      name: "TestThreadsConfig",
      platform: "threads",
      is_active: true,
      brand: "TestBrand",
      persona: "TestPersona",
      tone: "friendly",
      threads_email: "test@threads.com",
      threads_password: "password",
    });

    const jobs = await buildCronJobs();

    // Jobs should have _threads_ in their names
    const threadsJobs = jobs.filter((j) =>
      j.name.includes("_threads_")
    );
    expect(threadsJobs.length).toBeGreaterThan(0);

    // All jobs should have platform: threads
    jobs.forEach((job) => {
      if (job.name.includes("_threads_")) {
        expect(job.platform).toBe("threads");
      }
    });
  });

  test("buildCronJobs includes tone_override in prompts when specified", async () => {
    const config = await TopicConfig.create({
      name: "ConfigWithToneOverride",
      platform: "threads",
      is_active: true,
      brand: "Brand",
      persona: "Persona",
      tone: "professional",
      threads_email: "test@threads.com",
      threads_password: "pass",
      tone_override: {
        threads: "more casual, use emojis, friendly",
      },
    });

    const jobs = await buildCronJobs();

    // Messages should include tone override
    const drafJobs = jobs.filter(
      (j) => j.name.includes("draft") && j.name.includes("threads")
    );
    expect(draftJobs.length).toBeGreaterThan(0);

    draftJobs.forEach((job) => {
      expect(job.message).toContain("tone override");
    });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run test src/tests/schedulerService.platform.test.ts
```

Expected: All tests should PASS

- [ ] **Step 3: Commit**

```bash
git add src/tests/schedulerService.platform.test.ts
git commit -m "test: add platform-aware scheduler tests"
```

---

## Phase 7: Data Migration (1-2 hours)

### Task 7.1: Run Migration

**Files:**
- Already created in Phase 1

- [ ] **Step 1: Run migration script**

```bash
npm run migrate
```

Expected output:
```
Starting migration: add platform field...
TopicConfig migration: updated X records
Task migration: updated Y records
Migration complete!
```

- [ ] **Step 2: Verify migration**

```bash
npm run dev &
# Wait for server to start
curl http://localhost:3000/api/topic-config | jq '.[] | {name, platform}'
```

Expected: All TopicConfigs should have `platform: "x"`

- [ ] **Step 3: Stop dev server**

```bash
pkill -f "tsx watch src/index.ts"
```

---

## Phase 8: Integration Testing (1-2 hours)

### Task 8.1: Write E2E Tests

**Files:**
- Create: `src/tests/integration/multiPlatform.e2e.test.ts`

- [ ] **Step 1: Write E2E test file**

```typescript
/**
 * End-to-end tests for multi-platform workflow
 */
import { test, expect, describe, beforeEach } from "vitest";
import { TopicConfig } from "../../db/models/TopicConfig.js";
import { Task } from "../../db/models/Task.js";
import { getPlatformAdapter } from "../../integrations/index.js";
import { getPlatformCredentials } from "../../services/topicConfigService.js";

describe("Multi-Platform E2E", () => {
  beforeEach(async () => {
    await TopicConfig.deleteMany({});
    await Task.deleteMany({});
  });

  test("E2E: Create Threads TopicConfig and post via adapter", async () => {
    // 1. Create TopicConfig with Threads platform
    const config = await TopicConfig.create({
      name: "E2EThreadsBot",
      platform: "threads",
      is_active: true,
      brand: "TestBrand",
      persona: "TestPersona",
      tone: "casual",
      threads_email: "test@threads.com",
      threads_password: "password123",
    });

    expect(config.platform).toBe("threads");

    // 2. Get credentials
    const credentials = await getPlatformCredentials(config, "threads");
    expect(credentials.email).toBe("test@threads.com");

    // 3. Get adapter
    const adapter = getPlatformAdapter("threads", credentials);

    // 4. Create post
    const result = await adapter.createPost("Test post content");
    expect(result.postId).toBeDefined();

    // 5. Verify Task was created with correct platform
    const task = await Task.findById(result.postId);
    expect(task).toBeDefined();
    expect(task?.platform).toBe("threads");

    // 6. Verify task can be queried by threads-worker
    const threadsTask = await Task.findOne({
      platform: "threads",
      status: "PENDING",
    });
    expect(threadsTask).toBeDefined();
    expect(threadsTask?._id.toString()).toBe(result.postId);
  });

  test("E2E: Existing X bot continues to work with migration", async () => {
    // 1. Create old X config (pre-platform field)
    const config = await TopicConfig.create({
      name: "LegacyXBot",
      platform: "x", // Should be set by migration
      brand: "Brand",
      persona: "Persona",
      tone: "professional",
    });

    // 2. Verify platform field exists and is 'x'
    const fetched = await TopicConfig.findById(config._id);
    expect(fetched?.platform).toBe("x");

    // 3. Get X credentials
    process.env.X_EMAIL = "x@example.com";
    process.env.X_PASSWORD = "xpass";

    const credentials = await getPlatformCredentials(fetched, "x");
    expect(credentials.email).toBe("x@example.com");

    // 4. Create post via X adapter
    const xAdapter = getPlatformAdapter("x", credentials);
    const result = await xAdapter.createPost("X post");

    // 5. Verify task has platform=x
    const task = await Task.findById(result.postId);
    expect(task?.platform).toBe("x");
  });
});
```

- [ ] **Step 2: Run E2E tests**

```bash
npm run test src/tests/integration/multiPlatform.e2e.test.ts
```

Expected: All E2E tests should PASS

- [ ] **Step 3: Commit**

```bash
git add src/tests/integration/multiPlatform.e2e.test.ts
git commit -m "test: add multi-platform E2E tests"
```

---

## Phase 9: Final Validation & Cleanup

### Task 9.1: Type Check & Lint

- [ ] **Step 1: Run TypeScript type checker**

```bash
npm run typecheck
```

Expected: No errors

- [ ] **Step 2: Build project**

```bash
npm run build
```

Expected: No errors, `dist/` directory created

- [ ] **Step 3: Run all tests**

```bash
npm run test
```

Expected: All tests pass with >80% coverage

---

### Task 9.2: Documentation & Final Commit

- [ ] **Step 1: Create README for threads-worker**

Create `threads-worker/README.md`:
```markdown
# Threads Worker

Worker service for executing Threads automation tasks from the cinee-pipeline.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with MongoDB URI
```

3. Run worker:
```bash
npm run dev
```

## Architecture

- Polls MongoDB for `tasks` with `platform: 'threads'` and `status: 'PENDING'`
- Executes task handlers based on task type
- Updates task status to `COMPLETED` or `FAILED`
- Runs continuously until SIGINT signal

## Task Types

- `CREATE_POST` — Create a new post on Threads
- `REPLY` — Reply to a thread
- `SCRAPE` — Scrape notifications or topic posts
- `LIKE` — Like a post
- `BOOKMARK` — Bookmark a post

```

- [ ] **Step 2: Final commit**

```bash
git add threads-worker/README.md
git commit -m "docs: add threads-worker README"
```

---

## Summary of Commits

By the end of Phase 1-9, you should have these commits:

1. `feat: add platform fields to TopicConfig schema`
2. `feat: add platform field to Task schema with indexes`
3. `feat: add migration scripts for platform field`
4. `feat: add PlatformAdapter interface`
5. `feat: implement XAdapter for X.com platform`
6. `feat: implement ThreadsAdapter for Threads platform`
7. `feat: add adapter factory and barrel export`
8. `feat: add getPlatformCredentials to topicConfigService`
9. `feat: add platform parameter to prompt builders for adaptive personas`
10. `feat: make schedulerService platform-aware`
11. `feat: update scheduler routes to support multi-platform`
12. `feat: update topicConfig routes to handle platform fields`
13. `feat: create threads-worker project structure`
14. `feat: add logger to threads-worker`
15. `feat: create threads-worker main entry point`
16. `feat: create threads-worker task executor`
17. `test: add adapter implementation tests`
18. `test: add platform-aware scheduler tests`
19. `test: add multi-platform E2E tests`
20. `docs: add threads-worker README`

---

## Validation Checklist

- [ ] All TypeScript compiles without errors
- [ ] All tests pass (unit, integration, E2E)
- [ ] Migration script successfully adds platform fields to all records
- [ ] TopicConfig can be created with platform='threads'
- [ ] API endpoints accept platform parameter
- [ ] Scheduler service generates jobs with correct platform
- [ ] Both X and Threads tasks appear in MongoDB with correct platform
- [ ] threads-worker service starts without errors
- [ ] Adaptive persona tone overrides inject into prompts correctly
- [ ] Existing X bots continue to work unchanged (backward compatible)

---

## Rollback Plan

If issues arise:

1. Revert commits: `git revert HEAD~N..HEAD`
2. Run rollback migration: Create `rollback.ts` to remove platform fields
3. Restart services with previous code

---

**Plan Complete and Saved to `docs/superpowers/plans/2026-04-16-threads-platform-abstraction.md`**

Two execution options:

**1. Subagent-Driven (Recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session, batch execution with checkpoints

Which approach would you prefer?
