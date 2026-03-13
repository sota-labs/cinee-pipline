# Cinee Pipeline JS (Hybrid Architecture)

This is the social media automation pipeline for Cinee, migrated from Python to a hybrid Node.js/TypeScript + Python architecture. 

It preserves the powerful 3-layer CrewAI architecture (Brain, Execution, Community) in Python, but moves all tool implementations, database interactions, API integrations (Twitter, Reddit), configurations, and scheduling to a robust Node.js/TypeScript backend.

## Architecture

```
pipline-js/
├── src/                              ← Node.js/TypeScript Backend
│   ├── config/                       ← Settings, environment variables
│   ├── tools/                        ← All external tools (Twitter, Reddit, Redis, SQLite)
│   ├── services/                     ← Orchestration & Scheduler
│   ├── routes/                       ← REST API routes
│   └── app.ts / index.ts             ← Express server entry point
│
├── scripts/                          ← Python CrewAI Service
│   ├── agents/                       ← CrewAI agent definitions
│   ├── crews/                        ← Crew orchestration logic
│   ├── tasks/                        ← Task definitions
│   └── api_server.py                 ← FastAPI server exposing CrewAI endpoints
```

**How it works:**
1. The **Node.js Express Server** (`npm run dev`) runs on port `3000`. It handles all database connections (SQLite), memory cache (Redis), and external APIs (Twitter API v2, Snoowrap).
2. The **Python FastAPI Server** (`api_server.py`) runs on port `8000`. It runs the CrewAI agents. 
3. When the Node.js scheduler triggers a job (e.g., Daily Strategy), it calls the Python FastAPI endpoint.
4. When Python CrewAI agents need to perform actions (e.g., Post a tweet, search memory), they use HTTP tools to call back to the Node.js API endpoints (`/api/tools/*`).

## Getting Started

### Prerequisites
- Node.js 18+
- Python 3.10+
- Redis running on localhost:6379 (or configure `REDIS_URL`)

### 1. Environment Setup

```bash
# Clone or navigate to the directory
cd pipline-js

# Copy the environment file and fill in API keys
cp .env.example .env
```

You will need keys for:
- LLM Providers (OpenAI, Anthropic, Google)
- Twitter API v2 (App Key, App Secret, Access Token, Access Secret, Bearer Token)
- Reddit API (Client ID, Client Secret, Username, Password)

### 2. Node.js Setup

```bash
# Install dependencies
npm install

# (Optional) Verify TypeScript compiles cleanly
npm run typecheck
```

### 3. Python Setup

```bash
# Navigate to the Python service directory
cd scripts

# (Optional but recommended) Create a virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install requirements
pip install -r requirements.txt
```

## 🏃‍♂️ Running the Pipeline

You need to run both servers concurrently.

**Terminal 1: Python CrewAI Service**
```bash
cd pipline-js/scripts
# Make sure your venv is activated if you used one
uvicorn api_server:app --port 8000 --reload
```

**Terminal 2: Node.js Backend & Orchestrator**
```bash
cd pipline-js
npm run dev
```

## Scheduling

### OpenClaw Integration
The pipeline is designed to be fully integrated with [OpenClaw](https://docs.openclaw.ai/cli/cron). The Node.js scheduler API (`/api/scheduler/setup`) registers jobs into the OpenClaw Gateway using `openclaw cron add`. 

OpenClaw's cron emits specific **system events** when a schedule triggers. To execute the typescript jobs below, you need an OpenClaw Agent configured to listen to these system events and run the corresponding `npx tsx` local commands.

If you aren't using an OpenClaw Agent webhook/hook, you can execute these files via standard Linux `cron`.

### Manual / Standard Cron Execution
The pipeline uses these standalone TypeScript scripts intended to be triggered locally:

- `src/scripts/runPlanning.ts` — 9:00 AM Daily
- `src/scripts/runHotTake.ts` — 2:00 PM Daily 
- `src/scripts/runAmplification.ts` — Every 3 hours
- `src/scripts/runEngagement.ts` — Every 2 hours
- `src/scripts/runReddit.ts` — Every 4 hours
- `src/scripts/runMentions.ts` — Every 30 minutes

You can run these scripts manually for testing:
```bash
npx tsx src/scripts/runPlanning.ts
```

Or you can trigger them via the REST API while the Node.js server is running:
```bash
curl -X POST http://localhost:3000/api/pipeline/strategy
```
