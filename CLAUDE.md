# Project: cinee-pipeline (CEO Automation Pipeline)

## Architecture & Tech Stack

- **Language**: TypeScript (Node.js)
- **Database**: MongoDB (Mongoose) + Redis (ioredis)
- **Web Server**: Express
- **Automation Engine**: OpenClaw (via Task queue — cinee-worker executes CLI commands)
- **Task Scheduling**: Task records in MongoDB (cinee-worker polls and executes)

## Directory Structure

- `src/app.ts` / `src/index.ts`: Express application and server entry points.
- `src/config/`: Configuration files (`settings.ts` — maps env vars to `RoleConfig` + `Settings`).
- `src/db/`: MongoDB connection (`connection.ts`) and Mongoose models (`models/`).
  - Models: `CurationSource`, `Post`, `Reply`, `Interaction`, `PriorityAccount`, `TopicConfig`
- `src/prompts/`: Dynamic prompt template engine.
  - `humanStyleRules.ts` — human-like writing style rules (mild/moderate/heavy)
  - `promptBuilder.ts` — `buildResearchPrompt`, `buildDraftPrompt`, `buildReplyPrompt`, `buildInteractPrompt`, `buildRewritePrompt`
  - `index.ts` — barrel export
- `src/routes/`: Express route definitions (`contentReview`, `scheduler`, `status`, `tools`, `priorityAccounts`, `topicConfig`).
- `src/scripts/`: Standalone scripts for managing cron jobs.
- `src/services/`: Core logic (`schedulerService`, `schedulerPrompts`, `topicConfigService`, `openclawAgentService`).
- `src/tools/`: Helper modules (`contentTools`, `memoryTools`, `rateLimiter`).
- `src/utils/`: Utility functions (`logger.ts`).

## Context & Key Workflows

- **Dynamic Topics**: All prompts are built from the active `RoleConfig` — change `settings.ts`, a JSON file (`ROLE_CONFIG_PATH`), or activate a `TopicConfig` DB record via `POST /api/topic-config/:id/activate` to switch domains.
- **Human-like Writing**: `getHumanStyleRules("moderate")` injects casual-writing rules into every content prompt (no `;`, no `...`, acronyms, occasional typos).
- **OpenClaw Integration**: This repo creates Task records in MongoDB with prompts/commands. The separate `cinee-worker` service polls these tasks and executes openclaw CLI commands. This repo never executes CLI commands directly.
- **Cron Jobs**: Job definitions are registered as Task records in MongoDB via `npm run cron:add-all`.

## API Endpoints

| Route                                   | Description                                  |
| --------------------------------------- | -------------------------------------------- |
| `GET /api/topic-config`                 | List all topic configs                       |
| `GET /api/topic-config/active`          | Get currently active RoleConfig              |
| `POST /api/topic-config`                | Create a new topic config                    |
| `PATCH /api/topic-config/:id`           | Update a topic config                        |
| `DELETE /api/topic-config/:id`          | Delete a topic config                        |
| `POST /api/topic-config/:id/activate`   | Switch active topic (deactivates all others) |
| `POST /api/topic-config/deactivate-all` | Revert to settings.ts default                |

## Conventions & Rules

- **Formatting**: Use Prettier/ESLint standard formatting for TypeScript files.
- **Paths**: Import using relative paths with `.js` extension (Node16 module resolution).
- **Typings**: Strong typing for Mongoose models and Express requests. Avoid `any` — use `unknown` + type narrowing.
- **Error Handling**: Use the central `log` utility instead of `console.log`.
- **Async**: `schedulerService` functions are all `async` — always `await` them in routes/scripts.
- **Prompts**: Never hardcode persona, topics, or keywords in prompt strings. Always use `buildXxxPrompt(role, api)` from `src/prompts/promptBuilder.ts`.
