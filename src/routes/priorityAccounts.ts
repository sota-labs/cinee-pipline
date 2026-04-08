/**
 * Priority Accounts API — "The Inner Circle"
 *
 * Base path: /api/priority-accounts
 *
 * Endpoints:
 *   GET    /                          List accounts (filter by tier, is_manual_priority)
 *   POST   /                          Create a new priority account
 *   GET    /handle/:handle            Find account by X @handle
 *   POST   /recalculate               Batch-recompute all CS / HCS scores
 *   GET    /:id                       Get account by ID
 *   PATCH  /:id                       Update account fields (partial)
 *   DELETE /:id                       Remove account
 *   POST   /:id/interact              Record a single interaction event
 *   POST   /:id/reset-counters        Reset 30-day interaction counters
 */
import { Router, type Request, type Response } from "express";
import { ERelationshipTier } from "../db/models/PriorityAccount.js";
import * as svc from "../services/priorityAccountService.js";

export const priorityAccountsRouter = Router();

// ── List ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/priority-accounts
 *
 * Query params:
 *   tier              — STRATEGIC | CLOSE_FRIEND | ALLIED | STRANGER
 *   is_manual_priority — true | false
 *   limit             — default 20
 *   skip              — default 0
 */
priorityAccountsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const {
      tier,
      is_manual_priority,
      limit = "20",
      skip = "0",
    } = req.query;

    const filter: svc.ListAccountsFilter = {
      limit: parseInt(limit as string),
      skip: parseInt(skip as string),
    };

    if (tier) {
      if (!Object.values(ERelationshipTier).includes(tier as ERelationshipTier)) {
        return res.status(400).json({
          success: false,
          error: `Invalid tier. Must be one of: ${Object.values(ERelationshipTier).join(", ")}`,
        });
      }
      filter.tier = tier as ERelationshipTier;
    }

    if (is_manual_priority !== undefined) {
      filter.is_manual_priority = is_manual_priority === "true";
    }

    const { accounts, total } = await svc.listAccounts(filter);
    res.json({ success: true, accounts, total });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Create ────────────────────────────────────────────────────────────────────

/**
 * POST /api/priority-accounts
 *
 * Body:
 *   handle            string  required — @username on X
 *   is_manual_priority boolean optional (default false)
 *   vibe_notes        string  optional
 *   follower_count    number  optional
 *   likes_30d         number  optional
 *   comments_30d      number  optional
 *   shares_30d        number  optional
 *   last_seen_at      ISO8601 optional
 */
priorityAccountsRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { handle } = req.body;
    if (!handle) {
      return res.status(400).json({ success: false, error: "`handle` is required" });
    }

    const account = await svc.createAccount(req.body);
    res.status(201).json({ success: true, account });
  } catch (e: any) {
    const isDuplicate = e.code === 11000;
    res.status(isDuplicate ? 409 : 400).json({
      success: false,
      error: isDuplicate ? "An account with this handle already exists" : e.message,
    });
  }
});

// ── SCRAPE_PROMPT integration: bulk increment stats ───────────────────────────

/**
 * POST /api/priority-accounts/inc-stats
 *
 * Called by SCRAPE_PROMPT when new likes / comments / shares are detected
 * on the CEO's posts from a known handle.
 *
 * Body:
 *   handle    string  required — @username on X
 *   likes     number  optional — delta (not absolute value)
 *   comments  number  optional
 *   shares    number  optional
 *
 * Behaviour:
 *   • HINCRBY the daily Redis cache key (pa:daily:{handle}:{YYYY-MM-DD})
 *     for each non-zero field; key is created automatically if absent.
 *   • $inc the same fields in MongoDB.
 *   • Updates last_seen_at = now.
 *   • Recomputes CS / HCS / tier.
 *   • Returns 404 if the handle is not in the priority_accounts collection.
 */
priorityAccountsRouter.post("/inc-stats", async (req: Request, res: Response) => {
  try {
    const { handle, likes, comments, shares } = req.body;

    if (!handle) {
      return res.status(400).json({ success: false, error: "`handle` is required" });
    }

    const account = await svc.incStats({ handle, likes, comments, shares });

    if (!account) {
      return res.status(404).json({
        success: false,
        error: `No priority account found for handle "${handle}". Add them first via POST /api/priority-accounts.`,
      });
    }

    res.json({ success: true, account });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Batch recalculate ─────────────────────────────────────────────────────────

/**
 * POST /api/priority-accounts/recalculate
 *
 * Recomputes CS, HCS and tier for every account from current DB values.
 * Does NOT read Redis — use the daily cron for rolling-window accuracy.
 */
priorityAccountsRouter.post("/recalculate", async (_req: Request, res: Response) => {
  try {
    const result = await svc.recalculateAllScores();
    res.json({ success: true, ...result });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Lookup by handle ──────────────────────────────────────────────────────────

/**
 * GET /api/priority-accounts/handle/:handle
 *
 * The leading @ is optional (e.g. both "elonmusk" and "@elonmusk" work).
 */
priorityAccountsRouter.get("/handle/:handle", async (req: Request, res: Response) => {
  try {
    const account = await svc.getAccountByHandle(req.params.handle as string);
    if (!account) {
      return res.status(404).json({ success: false, error: "Account not found" });
    }
    res.json({ success: true, account });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Get by ID ─────────────────────────────────────────────────────────────────

priorityAccountsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const account = await svc.getAccountById(req.params.id as string);
    if (!account) {
      return res.status(404).json({ success: false, error: "Account not found" });
    }
    res.json({ success: true, account });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Update ────────────────────────────────────────────────────────────────────

/**
 * PATCH /api/priority-accounts/:id
 *
 * Accepts any subset of the writable fields.
 * Scores and tier are automatically recomputed after update.
 */
priorityAccountsRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const account = await svc.updateAccount(req.params.id as string, req.body);
    if (!account) {
      return res.status(404).json({ success: false, error: "Account not found" });
    }
    res.json({ success: true, account });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// ── Delete ────────────────────────────────────────────────────────────────────

priorityAccountsRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    const deleted = await svc.deleteAccount(req.params.id as string);
    if (!deleted) {
      return res.status(404).json({ success: false, error: "Account not found" });
    }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Record interaction ────────────────────────────────────────────────────────

/**
 * POST /api/priority-accounts/:id/interact
 *
 * Body:
 *   type  "like" | "comment" | "share"  required
 *
 * Increments the correct 30d counter, sets last_seen_at = now,
 * and recomputes CS / HCS / tier.
 */
priorityAccountsRouter.post("/:id/interact", async (req: Request, res: Response) => {
  try {
    const { type } = req.body;

    if (!["like", "comment", "share"].includes(type)) {
      return res.status(400).json({
        success: false,
        error: '`type` must be "like", "comment", or "share"',
      });
    }

    const account = await svc.recordInteraction(req.params.id as string, type);
    if (!account) {
      return res.status(404).json({ success: false, error: "Account not found" });
    }
    res.json({ success: true, account });
  } catch (e: any) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// ── Reset 30-day counters ─────────────────────────────────────────────────────

/**
 * POST /api/priority-accounts/:id/reset-counters
 *
 * Zeros out likes_30d, comments_30d, shares_30d and recomputes scores.
 * Intended to be called by a monthly cron job for each account.
 */
priorityAccountsRouter.post("/:id/reset-counters", async (req: Request, res: Response) => {
  try {
    const account = await svc.reset30dCounters(req.params.id as string);
    if (!account) {
      return res.status(404).json({ success: false, error: "Account not found" });
    }
    res.json({ success: true, account });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});
