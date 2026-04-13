/** Scheduler API routes. */
import { Router, type Request, type Response } from "express";
import * as schedulerService from "../services/schedulerService.js";

export const schedulerRouter = Router();

schedulerRouter.post("/setup", async (_req: Request, res: Response) => {
  try {
    const results = await schedulerService.registerIsolatedJobs();
    res.json({ message: "Cron jobs registered", results });
  } catch (error: unknown) {
    res.status(500).json({ error: (error as Error).message });
  }
});

schedulerRouter.get("/jobs", async (_req: Request, res: Response) => {
  try {
    const jobs = schedulerService.listJobs();
    const definitions = await schedulerService.getJobDefinitions();
    res.json({ output: jobs, definitions });
  } catch (error: unknown) {
    res.status(500).json({ error: (error as Error).message });
  }
});

schedulerRouter.delete("/jobs", async (_req: Request, res: Response) => {
  try {
    const results = await schedulerService.removeAllJobs();
    res.json({ message: "Jobs removed", results });
  } catch (error: unknown) {
    res.status(500).json({ error: (error as Error).message });
  }
});

schedulerRouter.get("/check", (_req: Request, res: Response) => {
  try {
    const healthy = schedulerService.checkGateway();
    res.json({ healthy });
  } catch (error: unknown) {
    res.status(500).json({ error: (error as Error).message });
  }
});
