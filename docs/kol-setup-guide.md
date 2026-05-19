# KOL Setup & Management Guide

**Last Updated:** 2026-05-19

## Overview

The KOL (Key Opinion Leader) system enables automated crawling, analysis, and engagement with tracked influencers. This guide covers setup, configuration, and best practices for managing KOL profiles and engagement.

---

## Quick Start

### 1. Add a Single KOL

```bash
curl -X POST http://localhost:3000/api/kols \
  -H "Content-Type: application/json" \
  -d '{
    "handle": "elonmusk",
    "display_name": "Elon Musk",
    "bio": "CEO of Tesla, SpaceX, etc.",
    "follower_count": 150000000,
    "is_verified": true,
    "tier": "S"
  }'
```

**Response:**
```json
{
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "handle": "elonmusk",
    "display_name": "Elon Musk",
    "tier": "S",
    "reputation_score": 50,
    "is_active": true,
    "created_at": "2026-05-19T10:30:00Z",
    "updated_at": "2026-05-19T10:30:00Z"
  }
}
```

### 2. Bulk Import KOLs

Import multiple KOLs at once. Supports two formats:

**Format 1: String array (all default to tier B)**
```bash
curl -X POST http://localhost:3000/api/kols/bulk-import \
  -H "Content-Type: application/json" \
  -d '{
    "handles": ["vitalik", "cz_binance", "SBF_FTX"]
  }'
```

**Format 2: Object array with tier specification**
```bash
curl -X POST http://localhost:3000/api/kols/bulk-import \
  -H "Content-Type: application/json" \
  -d '{
    "handles": [
      { "handle": "vitalik", "tier": "S" },
      { "handle": "cz_binance", "tier": "A" },
      { "handle": "SBF_FTX", "tier": "B" }
    ]
  }'
```

**Response:**
```json
{
  "data": {
    "created": 3,
    "existing": 0,
    "failed": 0
  }
}
```

---

## KOL Tier System

The tier system controls how strictly AFK skip rules are applied. Higher tiers bypass more restrictions.

| Tier | Description | Use Case | AFK Skip Rules |
|------|-------------|----------|---|
| **S** | Super VIP | Founders, major influencers | Bypasses ALL skip rules |
| **A** | High Priority | Active community members | Applies most rules, skips cashtag check |
| **B** | Standard | Regular KOLs | Applies all rules (default) |
| **C** | Low Priority | New/unvetted KOLs | Applies all rules + extra caution |

### Setting KOL Tier

**On creation:**
```bash
curl -X POST http://localhost:3000/api/kols \
  -H "Content-Type: application/json" \
  -d '{
    "handle": "vitalik",
    "tier": "S"
  }'
```

**On update:**
```bash
curl -X PATCH http://localhost:3000/api/kols/{kol_id} \
  -H "Content-Type: application/json" \
  -d '{
    "tier": "A"
  }'
```

---

## AFK Skip Rules

When AFK mode is enabled, the system automatically skips posts matching these rules. **Tier S KOLs bypass all rules.**

### Rule 1: Retweets/Reposts
Posts that are retweets or reposts are skipped (original content only).

**Detection:** `is_retweet: true`

### Rule 2: Cashtag Whitelist
Posts containing cashtags (e.g., `$BTC`, `$ETH`) not in the whitelist are skipped.

**Default Whitelist:**
```
WIF, BONK, PEPE, DOGE, SOL, BTC, ETH, BNB, BASE, SUI
```

**Example:**
- ✅ "Just bought more $SOL" — skipped (SOL in whitelist)
- ❌ "Check out $RANDOM_TOKEN" — skipped (RANDOM_TOKEN not in whitelist)

### Rule 3: Contract Addresses
Posts containing blockchain contract addresses are skipped:
- EVM addresses: `0x` + 40 hex chars
- Solana addresses: 32-44 base58 chars
- Sui object IDs: `0x` + 64 hex chars

**Example:**
- ❌ "Buy at 0x1234567890abcdef..." — skipped

### Rule 4: DEX/Pump Domains
Posts linking to DEX or pump platforms are skipped:
- dextools.io
- dexscreener.com
- pump.fun
- letsbonk.fun

**Example:**
- ❌ "Check chart: https://dextools.io/..." — skipped

### Rule 5: Quote Tweets with DEX URLs
Quote tweets whose quoted post URL contains a DEX domain are skipped.

**Example:**
- ❌ Quote tweet of a post linking to dextools.io — skipped

---

## Configuring AFK Skip Rules

### Update Cashtag Whitelist

```bash
curl -X PATCH http://localhost:3000/api/kol-settings \
  -H "Content-Type: application/json" \
  -d '{
    "afk_skip_cashtag_whitelist": ["WIF", "BONK", "PEPE", "DOGE", "SOL", "BTC", "ETH", "BNB", "BASE", "SUI", "USDC"]
  }'
```

### Get Current Settings

```bash
curl http://localhost:3000/api/kol-settings
```

**Response:**
```json
{
  "data": {
    "default_mode": "afk",
    "afk_skip_cashtag_whitelist": ["WIF", "BONK", "PEPE", "DOGE", "SOL", "BTC", "ETH", "BNB", "BASE", "SUI"],
    "afk": {
      "min_confidence_threshold": 70,
      "hourly_reply_limit": 10,
      "daily_reply_limit": 50
    },
    "safety": {
      "min_kol_trust_score": 30,
      "enable_duplicate_detection": true
    }
  }
}
```

---

## KOL Management

### List All KOLs

```bash
curl "http://localhost:3000/api/kols?page=1&limit=20&is_active=true"
```

**Query Parameters:**
- `page` — Page number (default: 1)
- `limit` — Results per page (default: 20, max: 100)
- `is_active` — Filter by active status (true/false)
- `min_reputation` — Filter by minimum reputation score
- `handle` — Search by handle (partial match)

### Get KOL Details

```bash
curl http://localhost:3000/api/kols/{kol_id}
```

### Get KOL Personality Profile

```bash
curl http://localhost:3000/api/kols/{kol_id}/personality
```

**Response:**
```json
{
  "data": {
    "handle": "vitalik",
    "personality": {
      "writing_style": "Technical, thoughtful",
      "common_topics": ["Ethereum", "scaling", "research"],
      "slang_words": ["gm", "based"],
      "emoji_pattern": "Minimal, occasional 🔬",
      "engagement_tone": "Educational, collaborative"
    }
  }
}
```

### Get KOL Posts

```bash
curl "http://localhost:3000/api/kols/{kol_id}/posts?page=1&limit=20"
```

### Trigger Manual Crawl

```bash
curl -X POST http://localhost:3000/api/kols/{kol_id}/crawl
```

### Trigger Personality Learning

```bash
curl -X POST http://localhost:3000/api/kols/{kol_id}/learn
```

---

## Engagement Modes

### AFK Mode (Automatic)

The system automatically replies to KOL posts matching criteria:
- Post passes all skip rules (or KOL is tier S)
- Reply confidence > threshold (default: 70%)
- Hourly/daily rate limits not exceeded

**Configuration:**
```bash
curl -X PATCH http://localhost:3000/api/kol-settings \
  -H "Content-Type: application/json" \
  -d '{
    "default_mode": "afk",
    "afk": {
      "min_confidence_threshold": 70,
      "hourly_reply_limit": 10,
      "daily_reply_limit": 50
    }
  }'
```

### Manual Mode (Review)

Replies are queued for human review before posting:

**Configuration:**
```bash
curl -X PATCH http://localhost:3000/api/kol-settings \
  -H "Content-Type: application/json" \
  -d '{
    "default_mode": "manual",
    "manual": {
      "notification_channel": "telegram",
      "max_pending_hours": 24
    }
  }'
```

---

## Best Practices

### Tier Assignment

1. **Tier S:** Only for trusted founders/major influencers
   - Bypasses all skip rules
   - Use sparingly to avoid spam

2. **Tier A:** Active community members with good reputation
   - Skips cashtag check (assumes trusted)
   - Still applies address/DEX rules

3. **Tier B:** Default for most KOLs
   - Full rule enforcement
   - Recommended starting point

4. **Tier C:** New or unvetted KOLs
   - Full rule enforcement
   - Consider upgrading after vetting

### Cashtag Whitelist Management

- **Add tokens:** Include only tokens relevant to your domain
- **Review regularly:** Remove tokens that become spam vectors
- **Test before adding:** Verify token legitimacy before whitelisting

### Monitoring

- Check reputation scores regularly
- Review skipped posts to tune rules
- Monitor engagement metrics per KOL
- Adjust tier assignments based on performance

---

## Troubleshooting

### Posts Not Being Replied To

1. Check KOL tier and skip rules
2. Verify cashtag whitelist includes relevant tokens
3. Check AFK mode settings and rate limits
4. Review post analysis and confidence scores

### Too Many Skipped Posts

1. Review cashtag whitelist — may be too restrictive
2. Check if KOL frequently posts about non-whitelisted tokens
3. Consider upgrading KOL tier if trusted
4. Review DEX domain list for false positives

### Engagement Not Matching Personality

1. Verify KOL personality profile is learned
2. Check if enough posts analyzed (minimum 10 posts)
3. Trigger manual personality learning: `POST /api/kols/{id}/learn`
4. Review learned traits in personality profile

---

## Related Documentation

- [System Architecture](./system-architecture.md) — KOL workflow details
- [Code Standards](./code-standards.md) — Implementation patterns
- [Development Roadmap](./development-roadmap.md) — Feature roadmap
