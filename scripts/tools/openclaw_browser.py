"""OpenClaw browser automation for autonomous social media operations.

Instead of calling Twitter/Reddit APIs directly, we send high-level goals
to OpenClaw which operates autonomously in the browser. The agent decides
how to search, what to click, and how to interact — we just provide the goal
and persona context.
"""
import subprocess
import json
import os
from typing import Optional

from crewai.tools import tool
from config.settings import settings

OPENCLAW_TIMEOUT = int(os.getenv("OPENCLAW_TIMEOUT", "600"))


def _get_persona_context() -> str:
    return f"""{settings.role.persona}

Name: {settings.role.founder_name}
Brand: {settings.role.brand} ({settings.role.website})
Tone: {settings.role.tone}
Stage: {settings.role.company_stage}"""


def _execute_openclaw(task_payload: dict) -> dict:
    """Execute a browser task via OpenClaw CLI.

    OpenClaw autonomously controls the browser to accomplish the goal.
    Returns a dict with at least 'success' and either 'output' or 'error'.
    """
    try:
        result = subprocess.run(
            ["openclaw", "run", "--task", json.dumps(task_payload)],
            capture_output=True,
            text=True,
            timeout=OPENCLAW_TIMEOUT,
        )

        if result.returncode == 0:
            try:
                return json.loads(result.stdout)
            except json.JSONDecodeError:
                return {"success": True, "output": result.stdout.strip()}

        return {
            "success": False,
            "error": result.stderr.strip() or f"Exit code {result.returncode}",
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Browser task timed out"}
    except FileNotFoundError:
        return {
            "success": False,
            "error": "openclaw CLI not found — install it first",
        }
    except Exception as exc:
        return {"success": False, "error": str(exc)}


# ---------------------------------------------------------------------------
# CrewAI tools — these are the ONLY interface agents need for social media
# ---------------------------------------------------------------------------


@tool("Execute Twitter browser task")
def twitter_browser_task(goal: str, drafted_content: str = "") -> str:
    """Autonomously execute a goal on Twitter via OpenClaw browser.

    The browser agent navigates twitter.com, searches, reads posts, and
    interacts entirely on its own. You only need to describe WHAT you want
    to achieve — not HOW to click or type.

    Args:
        goal: High-level objective, e.g.
              "Find 3 impressive AI films and quote-tweet with genuine appreciation"
              "Post this tweet about AI film distribution challenges"
              "Check notifications and reply to new mentions"
        drafted_content: Pre-written tweet/reply text to post. Leave empty
                         when the browser agent should compose on the fly.
    """
    payload = {
        "platform": "twitter",
        "url": "https://x.com",
        "goal": goal,
        "persona": _get_persona_context(),
        "drafted_content": drafted_content,
        "constraints": [
            "Stay under 280 characters per tweet",
            "Never directly promote or pitch any product",
            "Sound like a real person, not a brand account",
            "Be genuine and specific in every interaction",
        ],
    }

    result = _execute_openclaw(payload)
    return json.dumps(result, indent=2)


@tool("Execute Reddit browser task")
def reddit_browser_task(goal: str, drafted_content: str = "") -> str:
    """Autonomously execute a goal on Reddit via OpenClaw browser.

    Args:
        goal: High-level objective, e.g.
              "Find discussions about AI film hosting and contribute genuinely"
              "Start a discussion: Where are you hosting your AI films?"
        drafted_content: Pre-written post/comment text (optional).
    """
    payload = {
        "platform": "reddit",
        "url": "https://www.reddit.com",
        "goal": goal,
        "persona": _get_persona_context(),
        "drafted_content": drafted_content,
        "target_communities": settings.role.communities,
        "constraints": [
            "Never promote any product directly — Reddit hates that",
            "Be helpful and genuine in all interactions",
            "Let conversations lead to relevant topics naturally",
            "Start discussions, don't advertise",
        ],
    }

    result = _execute_openclaw(payload)
    return json.dumps(result, indent=2)
