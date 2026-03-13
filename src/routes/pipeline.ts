/** Pipeline API routes. */
import { Router, type Request, type Response } from "express";
import { pipelineService } from "../services/pipelineService.js";

export const pipelineRouter = Router();

pipelineRouter.post("/strategy", async (_req: Request, res: Response) => {
  try {
    const result = await pipelineService.runDailyStrategy();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

pipelineRouter.post("/amplification", async (req: Request, res: Response) => {
  try {
    const count = req.body?.count ?? 3;
    const result = await pipelineService.runAmplification(count);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

pipelineRouter.post("/hot-take", async (_req: Request, res: Response) => {
  try {
    const result = await pipelineService.runHotTake();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

pipelineRouter.post("/engagement", async (req: Request, res: Response) => {
  try {
    const count = req.body?.count ?? 10;
    const result = await pipelineService.runEngagement(count);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

pipelineRouter.post("/mentions", async (_req: Request, res: Response) => {
  try {
    const result = await pipelineService.runMentions();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

pipelineRouter.post("/reddit", async (req: Request, res: Response) => {
  try {
    const count = req.body?.count ?? 5;
    const result = await pipelineService.runReddit(count);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

pipelineRouter.post("/full-cycle", async (_req: Request, res: Response) => {
  try {
    const result = await pipelineService.runFullDailyCycle();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
