"""
FastAPI server exposing CrewAI operations.

Architecture: Node.js triggers these endpoints → CrewAI agents think/plan →
OpenClaw browser tools execute on Twitter/Reddit autonomously.

Start: uvicorn api_server:app --host 0.0.0.0 --port 8000 --reload
"""

import os
import sys
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config.settings import settings
from crews.brain_crew import BrainCrew
from crews.execution_crew import ExecutionCrew
from crews.cinee_crew import CineeCrew

app = FastAPI(
    title="Cinee Pipeline — CrewAI Service",
    description="CrewAI agents + OpenClaw browser automation for autonomous social media",
    version="2.0.0",
)


# -- Request models -----------------------------------------------------------

class CountRequest(BaseModel):
    count: Optional[int] = None


class StrategyRequest(BaseModel):
    strategy_context: Optional[str] = ""


# -- Health -------------------------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "crewai",
        "version": "2.0.0",
        "execution_mode": "openclaw_browser",
        "timestamp": str(datetime.now()),
    }


# -- Pipeline Endpoints -------------------------------------------------------

@app.post("/run-strategy")
async def run_strategy():
    """Brain Layer: daily strategy + Execution Layer: content planning."""
    try:
        print(f"\n[{datetime.now()}] === DAILY STRATEGY ===")

        brain = BrainCrew()
        strategy = brain.run_daily_strategy()

        execution = ExecutionCrew()
        plan = execution.plan_content(str(strategy))

        return {
            "success": True,
            "strategy": str(strategy),
            "plan": str(plan),
            "timestamp": str(datetime.now()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/run-amplification")
async def run_amplification(req: CountRequest = CountRequest()):
    """Find and amplify great AI films via browser."""
    try:
        count = req.count or 3
        print(f"\n[{datetime.now()}] === AMPLIFICATION (browser) ===")

        crew = CineeCrew()
        result = crew.amplify_ai_films(count=count)

        return {
            "success": True,
            "result": result,
            "timestamp": str(datetime.now()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/run-hot-take")
async def run_hot_take(req: StrategyRequest = StrategyRequest()):
    """Craft and post a CEO hot take via browser."""
    try:
        print(f"\n[{datetime.now()}] === HOT TAKE (browser) ===")

        crew = CineeCrew()
        result = crew.post_hot_take(strategy_context=req.strategy_context)

        return {
            "success": True,
            "result": result,
            "timestamp": str(datetime.now()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/run-engagement")
async def run_engagement(req: CountRequest = CountRequest()):
    """Engage with AI filmmakers on Twitter via browser."""
    try:
        count = req.count or 10
        print(f"\n[{datetime.now()}] === ENGAGEMENT (browser) ===")

        crew = CineeCrew()
        result = crew.engage_creators(count=count)

        return {
            "success": True,
            "result": result,
            "timestamp": str(datetime.now()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/run-mentions")
async def run_mentions():
    """Check and reply to Twitter mentions via browser."""
    try:
        print(f"\n[{datetime.now()}] === MENTIONS (browser) ===")

        crew = CineeCrew()
        result = crew.check_mentions()

        return {
            "success": True,
            "result": result,
            "timestamp": str(datetime.now()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/run-reddit")
async def run_reddit(req: CountRequest = CountRequest()):
    """Participate in Reddit discussions via browser."""
    try:
        count = req.count or 3
        print(f"\n[{datetime.now()}] === REDDIT (browser) ===")

        crew = CineeCrew()
        result = crew.engage_reddit(count=count)

        return {
            "success": True,
            "result": result,
            "timestamp": str(datetime.now()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/run-full-cycle")
async def run_full_cycle():
    """Run the complete daily pipeline cycle."""
    try:
        print(f"\n[{datetime.now()}] === FULL DAILY CYCLE ===")

        # Step 1: Brain — strategy
        brain = BrainCrew()
        strategy = str(brain.run_daily_strategy())

        # Step 2: CineeCrew — all social media tasks
        crew = CineeCrew()
        results = crew.run_daily_cycle(strategy_brief=strategy)
        results["strategy"] = strategy

        return {
            "success": True,
            "results": {k: str(v) for k, v in results.items()},
            "timestamp": str(datetime.now()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
