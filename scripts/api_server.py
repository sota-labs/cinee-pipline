"""
FastAPI server exposing CrewAI operations.

The Node.js backend calls these endpoints to trigger CrewAI agent workflows.
CrewAI agents call back to Node.js tool endpoints (http://localhost:3000/api/tools/*)
for Twitter, Reddit, Memory, DB operations.

Start: uvicorn api_server:app --host 0.0.0.0 --port 8000 --reload
"""

import os
import sys
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Add scripts dir to path so we can import agents/crews/tasks
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config.settings import settings
from crews.brain_crew import BrainCrew
from crews.execution_crew import ExecutionCrew
from crews.community_crew import CommunityCrew
from crews.cinee_crew import CineeTwitterWorkflow, CineeRedditWorkflow

app = FastAPI(
    title="Cinee Pipeline — CrewAI Service",
    description="Python CrewAI agent service called by the Node.js backend",
    version="1.0.0",
)


# ── Request models ──

class CountRequest(BaseModel):
    count: Optional[int] = None


class MentionRequest(BaseModel):
    max_results: Optional[int] = 10
    since_id: Optional[str] = None


# ── Health ──

@app.get("/health")
def health():
    return {"status": "ok", "service": "crewai", "timestamp": str(datetime.now())}


# ── Pipeline Endpoints ──

@app.post("/run-strategy")
async def run_strategy():
    """Run Brain Layer strategy + Execution Layer content planning."""
    try:
        print(f"\n[{datetime.now()}] === DAILY STRATEGY (API) ===")
        print(f"  CEO: {settings.role.founder_name} | Brand: {settings.role.brand}")

        # Layer 1: Brain — Strategy Analysis
        brain = BrainCrew()
        strategy = brain.run_daily_strategy()

        # Layer 2: Execution — Content Planning
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
    """Run AI film amplification workflow."""
    try:
        count = req.count or 3
        print(f"\n[{datetime.now()}] === AMPLIFICATION (API) ===")

        workflow = CineeTwitterWorkflow()
        result = workflow.amplify_ai_films(count=count)

        return {
            "success": True,
            "result": str(result),
            "count": count,
            "timestamp": str(datetime.now()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/run-hot-take")
async def run_hot_take():
    """Generate and post CEO hot take."""
    try:
        print(f"\n[{datetime.now()}] === HOT TAKE (API) ===")
        print(f"  Founder: {settings.role.founder_name}")

        workflow = CineeTwitterWorkflow()
        result = workflow.share_hot_take()

        return {
            "success": True,
            "result": str(result),
            "timestamp": str(datetime.now()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/run-engagement")
async def run_engagement(req: CountRequest = CountRequest()):
    """Engage with AI filmmakers on Twitter."""
    try:
        count = req.count or 10
        print(f"\n[{datetime.now()}] === ENGAGEMENT (API) ===")

        workflow = CineeTwitterWorkflow()
        result = workflow.engage_creators(count=count)

        return {
            "success": True,
            "result": str(result),
            "count": count,
            "timestamp": str(datetime.now()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/run-mentions")
async def run_mentions(req: MentionRequest = MentionRequest()):
    """Check and reply to Twitter mentions."""
    try:
        print(f"\n[{datetime.now()}] === MENTIONS (API) ===")

        community = CommunityCrew()

        # Note: In this architecture, the Node.js layer handles fetching mentions
        # via the Twitter tools. The Python layer only handles the CrewAI
        # draft_reply and publish_reply logic.
        # The Node.js pipelineService should fetch mentions first, then call
        # this endpoint with the mention data. For now, this is a placeholder
        # that shows the pattern.

        return {
            "success": True,
            "message": "Mention processing delegated to Node.js orchestrator",
            "timestamp": str(datetime.now()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/run-reddit")
async def run_reddit(req: CountRequest = CountRequest()):
    """Participate in Reddit discussions."""
    try:
        count = req.count or 5
        print(f"\n[{datetime.now()}] === REDDIT (API) ===")

        workflow = CineeRedditWorkflow()

        # Monitor communities
        monitor_result = workflow.monitor_communities()

        # Engage in discussions
        engage_result = workflow.engage_discussions(count=count)

        return {
            "success": True,
            "monitor_result": str(monitor_result),
            "engage_result": str(engage_result),
            "count": count,
            "timestamp": str(datetime.now()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/run-full-cycle")
async def run_full_cycle():
    """Run the complete daily pipeline cycle."""
    try:
        print(f"\n[{datetime.now()}] === FULL DAILY CYCLE (API) ===")

        results = {}

        # Strategy
        brain = BrainCrew()
        results["strategy"] = str(brain.run_daily_strategy())

        # Planning
        execution = ExecutionCrew()
        results["plan"] = str(execution.plan_content(results["strategy"]))

        # Amplification
        twitter_wf = CineeTwitterWorkflow()
        results["amplification"] = str(twitter_wf.amplify_ai_films(count=3))

        # Hot take
        results["hot_take"] = str(twitter_wf.share_hot_take())

        # Engagement
        results["engagement"] = str(twitter_wf.engage_creators(count=10))

        # Reddit
        reddit_wf = CineeRedditWorkflow()
        results["reddit"] = str(reddit_wf.engage_discussions(count=5))

        return {
            "success": True,
            "results": results,
            "timestamp": str(datetime.now()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
