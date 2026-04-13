/** Telegram routes — webhook registration and bot status. */
import { Router, type Request, type Response } from "express";
import * as telegramService from "../services/telegramService.js";
import { log } from "../utils/logger.js";

export const telegramRouter = Router();

/** Receive Telegram webhook updates (notifications only — no interactive callbacks). */
telegramRouter.post("/webhook", async (req: Request, res: Response) => {
  try {
    const update = req.body;
    log.debug(`Telegram webhook update received: ${JSON.stringify(update).slice(0, 200)}`);
    // Interactive actions (post_now, ai_rewrite, edit) are handled via REST API.
    res.sendStatus(200);
  } catch (e: any) {
    log.error(`Telegram webhook error: ${e.message}`);
    res.sendStatus(200);
  }
});

/** Setup webhook URL. */
telegramRouter.post("/setup", async (req: Request, res: Response) => {
  try {
    const { webhook_url } = req.body;
    if (!webhook_url) {
      return res
        .status(400)
        .json({ success: false, error: "webhook_url is required" });
    }
    const result = await telegramService.setupWebhook(webhook_url);
    res.json({ success: true, result });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

/** Get bot / webhook status. */
telegramRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    const info = await telegramService.getWebhookInfo();
    res.json({
      success: true,
      configured: telegramService.isConfigured(),
      webhook: info,
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});
