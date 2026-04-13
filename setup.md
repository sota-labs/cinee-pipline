# Setup Guide

## Prerequisites

- Node.js 22+
- MongoDB running locally or a remote URI
- Redis running locally or a remote URI
- OpenClaw CLI installed and accessible as `openclaw` in PATH

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```env
MONGO_URI=mongodb://localhost:27017/cinee_pipeline
REDIS_URL=redis://localhost:6379/0
PUBLIC_API_URL=http://localhost:3000
PORT=3000
FOUNDER_NAME=YourName
CINEE_TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
TELEGRAM_WEBHOOK_URL=https://yourdomain.com/api/telegram/webhook
X_USERNAME=your_x_handle
```

## 3. Run

```bash
# Development (hot reload)
npm run dev

# Production
npm run build
npm start
```

## 4. Register cron jobs

Run once after the server is up to register all scheduled jobs with OpenClaw:

```bash
npm run cron:add-all
```

Verify jobs are registered:

```bash
openclaw cron list
```

## 5. (Optional) Switch topic/persona

To switch the pipeline to a different topic domain at runtime, hit the API:

```bash
# Create a config
curl -X POST http://localhost:3000/api/topic-config \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Crypto",
    "brand": "TokenInsight",
    "persona": "You are a sharp crypto analyst...",
    "tone": "analytical, direct",
    "topics": ["DeFi", "Ethereum", "Bitcoin"],
    "search_keywords": ["DeFi TVL", "Ethereum L2", "Bitcoin dominance"]
  }'

# Activate it (use the _id from the response above)
curl -X POST http://localhost:3000/api/topic-config/<id>/activate

# Revert to default (settings.ts)
curl -X POST http://localhost:3000/api/topic-config/deactivate-all
```

Alternatively, point to a JSON file instead of using the API:

```env
ROLE_CONFIG_PATH=/path/to/your-config.json
```

The JSON can override any field from `RoleConfig` (all fields optional).

## 6. Run tests

```bash
npm test
```
