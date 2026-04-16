# Design Specification: Platform Abstraction Layer (Threads + X Integration)

**Date:** 2026-04-16  
**Author:** Claude Code (Brainstorming + Planning)  
**Status:** Ready for Implementation  
**Estimated Duration:** 18-23 hours

---

## Executive Summary

This document details a **Platform Abstraction Layer** approach to extend the existing X.com automation pipeline (`cinee-pipeline`) to support Meta's Threads platform. The design enables flexible per-bot platform selection via TopicConfig while maintaining existing X functionality and code patterns.

**Key Goals:**
- Add Threads support alongside X without breaking existing X automation
- Allow per-bot platform selection (each TopicConfig chooses 'x' or 'threads')
- Maintain full feature parity: posting, commenting, data collection, interactions
- Keep existing cinee-worker untouched; add separate threads-worker service
- Support adaptive personas (same core content, adjusted tone per platform)

---

## Architecture Overview

### Current Architecture (X-only)
```
TopicConfig → schedulerService → openclawAgentService → cinee-worker → X.com
```

### Proposed Architecture (Multi-platform)
```
TopicConfig (platform field) 
    ↓
schedulerService (platform-agnostic)
    ↓
PlatformAdapter (abstraction layer)
    ├── XAdapter → cinee-worker → X.com
    └── ThreadsAdapter → threads-worker → Threads
```

### Key Components

1. **TopicConfig** — Now includes `platform: 'x' | 'threads'` field
2. **PlatformAdapter Interface** — Common operations (post, reply, scrape, like, bookmark, metrics)
3. **XAdapter** — X-specific implementation (extracts existing logic)
4. **ThreadsAdapter** — Threads-specific implementation (new)
5. **SchedulerService** — Refactored to use adapters instead of hardcoded X
6. **threads-worker** — New service (mirrors cinee-worker architecture)

---

## Detailed Implementation Plan

### Phase 1: Data Model & Schema Updates (2-3 hours)

#### 1.1 Modify TopicConfig
**File:** `src/db/models/TopicConfig.ts`

**Add to ITopicConfig interface:**
```typescript
platform: 'x' | 'threads';           // Required: which platform to use
threads_email?: string;               // Threads account email
threads_password?: string;             // Threads account password
tone_override?: {                      // Optional: platform-specific tone adjustments
  x?: string;
  threads?: string;
}
```

**Add to Mongoose schema:**
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
}
```

**Backward Compatibility:** Migration script will set `platform: 'x'` for all existing configs.

#### 1.2 Modify Task Schema
**File:** `src/db/models/Task.ts`

**Add to ITask interface:**
```typescript
platform: 'x' | 'threads';    // Which platform this task targets
```

**Add to schema:**
```typescript
platform: {
  type: String,
  enum: ['x', 'threads'],
  default: 'x',
  required: true
},
```

**Add indexes:**
```typescript
taskSchema.index({ platform: 1, status: 1 });    // For worker queries
taskSchema.index({ type: 1, platform: 1 });      // For job type filtering
```

**Why:** Workers need to query only their platform's tasks.

#### 1.3 Update Post & Reply Models (Recommended)
**Files:** `src/db/models/Post.ts`, `src/db/models/Reply.ts`

Add `platform` field to track origin:
```typescript
platform: {
  type: String,
  enum: ['x', 'threads'],
  required: true
}
```

---

### Phase 2: Create Platform Adapter Architecture (3-4 hours)

#### 2.1 PlatformAdapter Interface
**New File:** `src/integrations/platformAdapter.ts`

```typescript
export interface PlatformAdapter {
  // Posting
  createPost(content: string, schedule?: Date): Promise<{ postId: string; scheduledAt?: Date }>;
  
  // Replying
  replyToThread(threadId: string, content: string): Promise<{ replyId: string }>;
  
  // Data Collection
  scrapeNotifications(): Promise<Array<{
    id: string;
    type: 'mention' | 'reply' | 'like';
    content: string;
    authorId: string;
    timestamp: Date;
  }>>;
  
  scrapeTopicPosts(keywords: string[]): Promise<Array<{
    id: string;
    content: string;
    author: string;
    likes: number;
    replies: number;
    timestamp: Date;
  }>>;
  
  // Interactions
  likePost(postId: string): Promise<void>;
  bookmarkPost(postId: string): Promise<void>;
  
  // Engagement Metrics
  getEngagementMetrics(postId: string): Promise<{
    likes: number;
    replies: number;
    reposts: number;
    views: number;
  }>;
  
  // Validation
  validateCredentials(): Promise<boolean>;
}
```

#### 2.2 XAdapter Implementation
**New File:** `src/integrations/xAdapter.ts`

- Extract hardcoded X logic from existing schedulerService
- Implement all PlatformAdapter interface methods
- Preserve existing behavior (no breaking changes)

#### 2.3 ThreadsAdapter Implementation
**New File:** `src/integrations/threadsAdapter.ts`

- Mirror XAdapter interface
- Implement for Threads platform (will use threads-worker to execute)

#### 2.4 Adapter Factory
**New File:** `src/integrations/adapterFactory.ts`

```typescript
export function getPlatformAdapter(
  platform: 'x' | 'threads',
  credentials: { email: string; password: string }
): PlatformAdapter {
  switch (platform) {
    case 'x': return new XAdapter(credentials);
    case 'threads': return new ThreadsAdapter(credentials);
    default: throw new Error(`Unknown platform: ${platform}`);
  }
}
```

---

### Phase 3: Refactor Services (5-6 hours)

#### 3.1 Update SchedulerService
**File:** `src/services/schedulerService.ts`

**Changes:**
- Remove hardcoded "scrape_x_notifications", "reply_x_notifications" etc.
- Use `buildCronJobs()` to accept platform parameter
- Store `platform` in Task records
- Query TopicConfig.platform instead of assuming X

**Example:**
```typescript
async function buildCronJobs(): Promise<CronJob[]> {
  const role = await getActiveRoleConfig();
  const topicConfig = await TopicConfig.findOne({ is_active: true });
  const platform = topicConfig?.platform || 'x';
  const platformSuffix = platform;  // 'x' or 'threads'
  
  return [
    {
      name: `scrape_notifications_${platformSuffix}_${topicSuffix}`,
      schedule: "20 * * * *",
      message: SCRAPE_PROMPT,
      platform,  // NEW: attach platform
      description: `Scrape ${platform} notifications...`
    },
    // ... more jobs ...
  ];
}
```

#### 3.2 Update SchedulerPrompts
**File:** `src/services/schedulerPrompts.ts`

**Changes:**
- Add `platform` parameter to all builder functions
- Inject `tone_override` adjustment if present
- Support adaptive persona generation

**Example:**
```typescript
export function buildDraftPrompt(
  role: RoleConfig,
  api: string,
  platform: 'x' | 'threads' = 'x'
): string {
  const toneAdjustment = role.tone_override?.[platform] ? 
    `\nAdditional tone for ${platform}: ${role.tone_override[platform]}` : '';
  
  return `Brand: ${role.brand}\nPersona: ${role.persona}\nTone: ${role.tone}${toneAdjustment}...`;
}
```

#### 3.3 Update TopicConfigService
**File:** `src/services/topicConfigService.ts`

**Add function:**
```typescript
export async function getPlatformCredentials(
  topicConfig: ITopicConfig,
  platform: 'x' | 'threads'
): Promise<{ email: string; password: string }> {
  if (platform === 'x') {
    return { email: process.env.X_EMAIL || '', password: process.env.X_PASSWORD || '' };
  }
  if (platform === 'threads') {
    return { email: topicConfig.threads_email || '', password: topicConfig.threads_password || '' };
  }
  throw new Error(`Unknown platform: ${platform}`);
}
```

---

### Phase 4: Update Routes & API Endpoints (1-2 hours)

#### 4.1 Scheduler Routes
**File:** `src/routes/scheduler.ts`

**Changes:**
- Add `platform` query parameter or body field
- Use `getPlatformAdapter()` before executing operations
- Store platform in Task records

**Example:**
```typescript
router.post('/post', async (req, res) => {
  const { content, schedule, topicConfigId, platform } = req.body;
  
  const topicConfig = topicConfigId 
    ? await TopicConfig.findById(topicConfigId)
    : await TopicConfig.findOne({ is_active: true });
  
  const targetPlatform = platform || topicConfig?.platform || 'x';
  const credentials = await getPlatformCredentials(topicConfig, targetPlatform);
  const adapter = getPlatformAdapter(targetPlatform, credentials);
  
  const result = await adapter.createPost(content, schedule);
  
  // Store Task
  const task = new Task({
    type: `create_post_${targetPlatform}`,
    platform: targetPlatform,
    message: JSON.stringify({ content, schedule }),
    status: ETaskStatus.PENDING
  });
  await task.save();
  
  res.json({ success: true, postId: result.postId });
});
```

#### 4.2 TopicConfig Routes
**File:** `src/routes/topicConfig.ts`

- Validate `platform` field in POST/PATCH
- Accept `threads_email`, `threads_password`, `tone_override`

---

### Phase 5: Create Threads Worker Service (3-4 hours)

#### 5.1 Directory Structure
```
threads-worker/
├── src/
│   ├── index.ts              # Main: poll for Threads tasks
│   ├── executor.ts           # Execute Threads CLI commands
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
```

#### 5.2 Main Entry Point
**File:** `threads-worker/src/index.ts`

```typescript
import { MongoClient } from 'mongodb';

const POLL_INTERVAL = 5000;  // 5 seconds
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cinee';

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('cinee');
  
  while (true) {
    try {
      // Poll for pending Threads tasks
      const task = await db.collection('tasks').findOne({
        platform: 'threads',
        status: 'PENDING'
      });
      
      if (task) {
        await executeTask(db, task);
      } else {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
      }
    } catch (error) {
      console.error(error);
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
  }
}

async function executeTask(db: Db, task: any) {
  try {
    switch (task.type) {
      case 'create_post_threads':
        await handleCreatePost(task);
        break;
      case 'reply_threads':
        await handleReply(task);
        break;
      // ... more handlers ...
    }
    
    await db.collection('tasks').updateOne(
      { _id: task._id },
      { $set: { status: 'COMPLETED', updated_at: new Date() } }
    );
  } catch (error) {
    await db.collection('tasks').updateOne(
      { _id: task._id },
      { $set: { status: 'FAILED', error: String(error), updated_at: new Date() } }
    );
  }
}

main().catch(console.error);
```

---

### Phase 6: Update Prompts for Adaptive Personas (2-3 hours)

#### 6.1 PromptBuilder Updates
**File:** `src/prompts/promptBuilder.ts`

Add `platform` parameter to all builders:
- `buildResearchPrompt(role, api, platform)`
- `buildDraftPrompt(role, api, platform)`
- `buildReplyPrompt(role, api, platform)`
- `buildInteractPrompt(role, api, platform)`

When `tone_override[platform]` exists, inject it into the prompt.

---

### Phase 7: Testing Strategy (3-4 hours)

#### 7.1 Unit Tests for Adapters
**File:** `src/tests/adapters.test.ts`

- Test that XAdapter implements PlatformAdapter
- Test that ThreadsAdapter implements PlatformAdapter
- Test adapter factory returns correct implementation

#### 7.2 Integration Tests
**File:** `src/tests/schedulerService.platform.test.ts`

- Test `buildCronJobs()` respects TopicConfig.platform
- Test Tasks created with correct platform field
- Test prompt builder injects tone overrides

#### 7.3 E2E Tests
- Create Threads TopicConfig
- POST /api/scheduler/post with platform=threads
- Verify Task created with platform=threads
- Verify threads-worker processes task

---

### Phase 8: Data Migration & Rollback (1-2 hours)

#### 8.1 Migration Script
**File:** `src/scripts/migrateToMultiPlatform.ts`

```typescript
// Add platform: 'x' to all existing TopicConfigs
// Add platform: 'x' to all existing Tasks
```

**Run:** `npm run migrate`

#### 8.2 Rollback Script
**File:** `src/scripts/rollbackMultiPlatform.ts`

Remove platform fields if needed.

---

### Phase 9: Environment Configuration

#### 9.1 Update .env
```bash
# Existing X credentials (unchanged)
X_EMAIL=user@example.com
X_PASSWORD=xxxxx

# Threads credentials (can also be per-config in DB)
THREADS_EMAIL=threads_user@example.com
THREADS_PASSWORD=xxxxx

# Worker services
CINEE_WORKER_ENABLED=true
THREADS_WORKER_ENABLED=true

# Shared
MONGODB_URI=mongodb://localhost:27017/cinee
REDIS_URL=redis://localhost:6379
```

---

## Breaking Changes & Backward Compatibility

| Change | Breaking | Mitigation |
|--------|----------|-----------|
| TopicConfig.platform field required | YES | Migration script; default to 'x' |
| Task.platform field required | YES | Migration script; default to 'x' |
| SchedulerService accepts platform param | NO | Optional param, defaults to 'x' |
| Prompt builders accept platform param | NO | Optional param, defaults to 'x' |
| Routes accept platform query/body param | NO | Optional, defaults to active config's platform |

**Rollback Plan:**
1. Keep cinee-worker running (handles all X tasks)
2. Migration script sets platform='x' for all records
3. If needed, remove platform fields and restart services

---

## Dependencies & Risks

### External Dependencies
- **OpenClaw** — Already in use for X, will be used for Threads
- **MongoDB** — Already in use
- **Redis** — Already in use

### Risks

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Unknown Threads CLI behavior with OpenClaw | HIGH | Research Threads browser automation before Phase 5 |
| Data migration affecting existing X bots | MEDIUM | Test migration script on staging; keep rollback ready |
| Prompt tone adaptation not working well | MEDIUM | Start with simple rules; iterate based on results |
| Worker service coordination (both workers running) | LOW | Each worker queries only its platform; no conflicts |

---

## Timeline & Effort

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| 1. Data Models | 2-3h | — |
| 2. Adapters | 3-4h | Phase 1 |
| 3. Services | 5-6h | Phase 2 |
| 4. Routes | 1-2h | Phase 3 |
| 5. Threads Worker | 3-4h | Phase 1, 2 |
| 6. Prompts | 2-3h | Phase 3 |
| 7. Testing | 3-4h | Phases 1-6 |
| 8. Migration | 1-2h | All phases |
| 9. Config | 0.5-1h | All phases |
| **TOTAL** | **18-23h** | Sequential |

---

## Success Criteria

1. ✅ X.com automation continues unchanged
2. ✅ New TopicConfig with `platform: 'threads'` works end-to-end
3. ✅ Threads posts, replies, scraping, and interactions functional
4. ✅ Adaptive personas (tone changes per platform) working
5. ✅ Both cinee-worker and threads-worker running in parallel
6. ✅ Task records correctly route to appropriate worker
7. ✅ 80%+ test coverage for platform abstraction layer
8. ✅ Existing bots migrated with `platform: 'x'` (backward compatible)

---

## Next Steps (Post-Approval)

1. **Invoke writing-plans** — Create detailed task list for implementation
2. **Execute Phase 1-2** — Set up data models and adapters
3. **Execute Phase 3-4** — Refactor services and routes
4. **Execute Phase 5-6** — Create worker and prompts
5. **Execute Phase 7-8** — Test and migrate data
6. **Deploy** — Push to staging, then production

---

**Approval Status:** ✅ Ready for Implementation

**Questions or modifications needed before proceeding?**
