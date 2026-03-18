/** Scheduler API routes. */
import { Router, type Request, type Response } from "express";
import * as schedulerService from "../services/schedulerService.js";

export const schedulerRouter = Router();

schedulerRouter.post("/setup", (req: Request, res: Response) => {
  try {
    const results = schedulerService.registerAllJobs();
    res.json({ message: "Jobs registered", results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

schedulerRouter.post("/setup-isolated", (_req: Request, res: Response) => {
  try {
    const results = schedulerService.registerIsolatedJobs();
    res.json({ message: "Isolated cron jobs registered", results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

schedulerRouter.get("/jobs", (_req: Request, res: Response) => {
  try {
    const jobs = schedulerService.listJobs();
    const definitions = schedulerService.getJobDefinitions();
    res.json({ output: jobs, definitions });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

schedulerRouter.delete("/jobs", (_req: Request, res: Response) => {
  try {
    const results = schedulerService.removeAllJobs();
    res.json({ message: "Jobs removed", results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

schedulerRouter.get("/check", (_req: Request, res: Response) => {
  try {
    const healthy = schedulerService.checkGateway();
    res.json({ healthy });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
