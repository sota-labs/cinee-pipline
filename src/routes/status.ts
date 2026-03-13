/** Status / health API routes. */
import { Router, type Request, type Response } from "express";
import * as statusService from "../services/statusService.js";

export const statusRouter = Router();

statusRouter.get("/health", (_req: Request, res: Response) => {
  res.json(statusService.getHealthCheck());
});

statusRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    const status = await statusService.getSystemStatus();
    res.json(status);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
