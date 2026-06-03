# Code Standards & Codebase Structure

**Last Updated:** 2026-05-18

## Overview

This document defines the coding standards, conventions, and architectural patterns used throughout the cinee-pipeline project.

---

## Directory Structure

```
cinee-pipeline/
├── src/
│   ├── app.ts                    # Express application setup
│   ├── index.ts                  # Server entry point
│   ├── config/
│   │   └── settings.ts           # Configuration and environment mapping
│   ├── db/
│   │   ├── connection.ts         # MongoDB connection
│   │   └── models/
│   │       ├── CurationSource.ts
│   │       ├── Post.ts
│   │       ├── Reply.ts
│   │       ├── Interaction.ts
│   │       ├── PriorityAccount.ts
│   │       ├── TopicConfig.ts
│   │       ├── OwnAccountProfile.ts
│   │       ├── KolProfile.ts
│   │       ├── KolPost.ts
│   │       ├── KolReplySuggestion.ts
│   │       ├── KolReputationCache.ts
│   │       ├── KolSettings.ts
│   │       ├── SelfReplyQueue.ts
│   │       └── Task.ts
│   ├── prompts/
│   │   ├── index.ts              # Barrel export
│   │   ├── humanStyleRules.ts    # Human-like writing rules
│   │   ├── promptBuilder.ts      # Dynamic prompt builders
│   │   └── ownAccountPrompts.ts  # Own account learning prompts
│   ├── routes/
│   │   ├── contentReview.ts
│   │   ├── scheduler.ts
│   │   ├── status.ts
│   │   ├── tools.ts
│   │   ├── priorityAccounts.ts
│   │   ├── topicConfig.ts
│   │   ├── tasks.ts              # Task webhook handlers
│   │   ├── kols.ts               # KOL management routes
│   │   ├── kolPosts.ts           # KOL post routes
│   │   ├── kolSettings.ts        # KOL settings routes
│   │   └── account.ts            # Account personality & post seeding routes
│   ├── scripts/
│   │   ├── addAllJobs.ts
│   │   ├── addJob.ts
│   │   ├── removeAllJobs.ts
│   │   ├── removeJob.ts
│   │   ├── setupCronJobs.ts
│   │   ├── scanAndPostCron.ts
│   │   ├── dailyRollingWindowCron.ts
│   │   ├── kolAnalyzeCron.ts
│   │   ├── kolAFKReplyCron.ts
│   │   ├── kolDaemon.ts
│   │   ├── selfReplyCron.ts
│   │   ├── ownAccountLearnCron.ts
│   │   └── seedOwnAccountPostsCron.ts
│   ├── services/
│   │   ├── schedulerService.ts
│   │   ├── schedulerPrompts.ts
│   │   ├── topicConfigService.ts
│   │   ├── openclawAgentService.ts
│   │   ├── ownAccountService.ts      # Personality learning
│   │   ├── ownAccountCrawlerService.ts # Post seeding
│   │   ├── selfReplyService.ts       # Reply generation
│   │   ├── replyEngineService.ts     # Reply validation
│   │   ├── kolCrawlerService.ts      # KOL post crawling
│   │   ├── kolAnalyzerService.ts     # KOL analysis
│   │   ├── reputationCheckerService.ts # Reputation scoring
│   │   ├── priorityAccountService.ts # Priority accounts
│   │   └── statusService.ts          # System status
│   ├── tools/
│   │   ├── contentTools.ts
│   │   ├── memoryTools.ts
│   │   └── rateLimiter.ts
│   └── utils/
│       ├── logger.ts             # Centralized logging
│       └── kolPostSkipRules.ts   # AFK skip rule evaluation
├── docs/
│   ├── development-roadmap.md
│   ├── project-changelog.md
│   ├── system-architecture.md
│   └── code-standards.md
├── package.json
├── tsconfig.json
├── .eslintrc.json
├── .prettierrc.json
└── README.md
```

---

## Naming Conventions

### Files

- **Format**: kebab-case with descriptive names
- **Examples**: `own-account-service.ts`, `priority-accounts.ts`, `human-style-rules.ts`
- **Rationale**: Clear purpose visible in file listings and grep results

### Variables & Functions

- **camelCase** for variables and functions
- **PascalCase** for classes and types
- **UPPER_SNAKE_CASE** for constants

```typescript
// Variables
const userProfile = await getProfile();
let isLearning = false;

// Functions
function buildOwnAccountLearningPrompt(role: RoleConfig): string {}
async function learnPersonality(tweets: Tweet[]): Promise<Task> {}

// Classes
class OwnAccountService {}
interface PersonalityProfile {}

// Constants
const DEFAULT_LEARNING_HOUR = 3;
const MAX_RETRY_ATTEMPTS = 3;
```

---

## Import Conventions

### Module Resolution

- **Node16 module resolution** — all relative imports use `.js` extension
- **Barrel exports** — use `index.ts` for module exports

```typescript
// Correct
import { buildOwnAccountLearningPrompt } from '../prompts/index.js';
import { OwnAccountService } from '../services/ownAccountService.js';

// Incorrect (missing .js extension)
import { buildOwnAccountLearningPrompt } from '../prompts';
```

### Import Organization

1. External packages (express, mongoose, etc.)
2. Internal modules (services, models, utils)
3. Types and interfaces

```typescript
import express, { Request, Response } from 'express';
import { OwnAccountService } from '../services/ownAccountService.js';
import { logger } from '../utils/logger.js';
import type { OwnAccountProfile } from '../db/models/OwnAccountProfile.js';
```

---

## Type Safety

### Avoid `any`

- **Never use `any`** — use `unknown` with type narrowing instead
- **Always type function parameters and return values**
- **Use interfaces for object shapes**

```typescript
// Correct
function processResult(data: unknown): string {
  if (typeof data === 'string') {
    return data.toUpperCase();
  }
  throw new Error('Expected string');
}

// Incorrect
function processResult(data: any): any {
  return data.toUpperCase();
}
```

### Mongoose Models

- **Strong typing** for all model fields
- **Use interfaces** for document shapes
- **Export types** for external use

```typescript
interface IOwnAccountProfile {
  manual_config: ManualConfig;
  learned_profile: LearnedProfile;
  effective_profile: EffectiveProfile;
  created_at: Date;
  updated_at: Date;
}

const OwnAccountProfileSchema = new Schema<IOwnAccountProfile>({
  manual_config: { type: Object, required: true },
  learned_profile: { type: Object, required: true },
  effective_profile: { type: Object, required: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});
```

---

## Error Handling

### Try-Catch Pattern

- **Always use try-catch** for async operations
- **Log errors** using centralized logger
- **Return meaningful error messages**

```typescript
async function learnPersonality(tweets: Tweet[]): Promise<Task> {
  try {
    const prompt = buildOwnAccountLearningPrompt(role, api);
    const task = await createTask('own_account_personality', prompt);
    return task;
  } catch (error) {
    logger.error('Failed to learn personality', { error, tweetsCount: tweets.length });
    throw new Error('Personality learning failed');
  }
}
```

### Logging

- **Use centralized logger** from `src/utils/logger.ts`
- **Never use `console.log`**
- **Include context** in log messages

```typescript
// Correct
logger.info('Personality profile updated', { profileId, traits: profile.traits });
logger.error('Task webhook failed', { taskId, error: error.message });

// Incorrect
console.log('Profile updated');
console.error(error);
```

---

## Async/Await

### Always Await Promises

- **All async functions must be awaited**
- **Never fire-and-forget** unless intentional
- **Use Promise.all()** for parallel operations

```typescript
// Correct
const profile = await getProfile();
const [tweets, interactions] = await Promise.all([
  getTweets(),
  getInteractions()
]);

// Incorrect
getProfile(); // Promise not awaited
```

### Service Functions

- **All service functions are async**
- **Always await service calls** in routes and scripts

```typescript
// In routes
router.get('/api/account/personality', async (req, res) => {
  try {
    const profile = await ownAccountService.getProfile();
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

---

## Prompts & Dynamic Content

### Never Hardcode Persona

- **Always use `buildXxxPrompt(role, api)`** from `src/prompts/promptBuilder.ts`
- **Never hardcode topics, keywords, or persona** in prompt strings
- **Inject human-style rules** for all content prompts

```typescript
// Correct
const prompt = buildOwnAccountLearningPrompt(role, api);
const replyPrompt = buildReplyPrompt(role, api);

// Incorrect
const prompt = `Analyze tweets for ${role.name}...`; // Hardcoded
```

### Human-like Writing Rules

- **All content prompts include human-style rules**
- **Use `getHumanStyleRules(intensity)`** to inject rules

```typescript
const rules = getHumanStyleRules('moderate');
// Returns: no semicolons, no ellipsis, casual acronyms, occasional typos

const prompt = `${basePrompt}\n\nWriting style rules:\n${rules}`;
```

---

## Configuration Management

### Environment Variables

- **Store all config in environment variables**
- **Map to `RoleConfig` in `src/config/settings.ts`**
- **Never hardcode secrets or API keys**

```typescript
// In settings.ts
export const settings = {
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/cinee',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  openclawApiKey: process.env.OPENCLAW_API_KEY,
  roleConfigPath: process.env.ROLE_CONFIG_PATH || './role-config.json'
};
```

### Dynamic Topic Configuration

- **Use `TopicConfig` model** for switching domains
- **Activate via `POST /api/topic-config/:id/activate`**
- **Deactivate via `POST /api/topic-config/deactivate-all`**

---

## Code Organization

### File Size Limits

- **Keep files under 200 lines** for optimal context management
- **Split large files** into smaller, focused modules
- **Use composition** over inheritance for complex logic

### Service Layer

- **One service per domain** (e.g., `ownAccountService`, `selfReplyService`)
- **Export public methods** only
- **Keep business logic** in services, not routes

```typescript
// src/services/ownAccountService.ts
export class OwnAccountService {
  async getProfile(): Promise<OwnAccountProfile> { }
  async updateManualConfig(config: ManualConfig): Promise<OwnAccountProfile> { }
  async learnPersonality(tweets: Tweet[]): Promise<Task> { }
  async applyLearnedProfile(learned: LearnedProfile): Promise<OwnAccountProfile> { }
}
```

### Route Layer

- **Keep routes thin** — delegate to services
- **Validate input** before calling services
- **Return consistent response format**

```typescript
router.get('/api/account/personality', async (req, res) => {
  try {
    const profile = await ownAccountService.getProfile();
    res.json({ success: true, data: profile });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

---

## Cron Scheduling Patterns

- **Server-local time** — cron schedules and `prime_window` hours are interpreted in the server's local timezone. Production runs UTC. Configure `prime_window` in UTC hours (e.g. `02:00-06:00` for `09:00-13:00` ICT).
- **Extract testable functions** — wrap `cron.schedule("…", handler)` around an exported function in a dedicated service (e.g. `kolScheduleService.runPrimePolling`). The cron script becomes a thin wrapper.
- **Use mutexes** — handlers that may overlap (a 2h and 3h cron firing at the same minute) need a `let isXxxRunning = false` guard that early-returns with a warn.
- **The prime-window pattern** — Tier S uses X API polling during a configurable 4h "prime window" (default 09:00-13:00 UTC) for low latency, and falls back to OpenClaw batch tasks the rest of the day. See `docs/notes/prime-window-and-batch-schedule.md`.
- **Multi-instance deployments** — in-process mutexes don't protect against double-execution across instances. Use a Redis lock for cross-process safety (out of scope; follow-up).

---

## Testing

### Unit Tests

- **Write tests for all services**
- **Test error scenarios**
- **Aim for high code coverage**

### Integration Tests

- **Test API endpoints** with real database
- **Test webhook callbacks**
- **Test cron job execution**

---

## Code Quality

### Linting & Formatting

- **Run ESLint** before commit
- **Run Prettier** for consistent formatting
- **Fix all linting errors** (warnings are acceptable)

```bash
npm run lint
npm run format
```

### Compilation

- **Always compile TypeScript** before committing
- **Fix all compilation errors**

```bash
npm run build
```

---

## Git Conventions

### Commit Messages

- **Use conventional commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- **Keep commits focused** on actual code changes
- **No AI references** in commit messages

```
feat: add own account personality learning service
fix: handle webhook callback for self-reply generation
docs: update system architecture documentation
```

### Branch Naming

- **Use kebab-case**: `feature/own-account-learning`, `fix/webhook-handler`
- **Include ticket number** if applicable: `feature/TICKET-123-own-account-learning`

---

## Security Best Practices

- **Validate all user inputs** before processing
- **Use parameterized queries** for database operations
- **Never log sensitive data** (API keys, passwords)
- **Sanitize task payloads** before OpenClaw execution
- **Verify webhook signatures** (if applicable)

---

## Performance Best Practices

- **Use async/await** for all I/O operations
- **Implement connection pooling** for MongoDB and Redis
- **Schedule heavy tasks** during off-peak hours
- **Use task queue** to prevent blocking operations
- **Cache frequently accessed data** in Redis

---

## Documentation

### Code Comments

- **Add comments for complex logic** only
- **Explain the "why"**, not the "what"
- **Keep comments up-to-date** with code changes

```typescript
// Correct
// Merge manual config with learned profile to create effective personality
const effective = mergeProfiles(manual, learned);

// Incorrect
// Set effective to merged profiles
const effective = mergeProfiles(manual, learned);
```

### Function Documentation

- **Add JSDoc comments** for public functions
- **Include parameter types and return types**
- **Add usage examples** for complex functions

```typescript
/**
 * Learn CEO personality from recent tweets
 * @param tweets - Array of recent tweets to analyze
 * @returns Task record for OpenClaw execution
 * @throws Error if learning fails
 * @example
 * const task = await ownAccountService.learnPersonality(tweets);
 */
async function learnPersonality(tweets: Tweet[]): Promise<Task> { }
```

---

## Related Documentation

- [System Architecture](./system-architecture.md)
- [Development Roadmap](./development-roadmap.md)
- [Project Changelog](./project-changelog.md)
