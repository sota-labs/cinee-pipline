"""Cinee autonomous crew for AI filmmaker community engagement.

Architecture change: instead of micro-managing Twitter/Reddit API calls,
we give high-level goals to a Writer agent equipped with OpenClaw browser
tools. The agent decides what to say (CEO voice) and the browser tool
autonomously handles searching, navigating, and interacting.
"""
from crewai import Crew, Process

from agents.community import create_writer_agent
from agents.brain import create_strategy_agent
from tasks.cinee_tasks import (
    create_amplification_goal,
    create_hot_take_goal,
    create_engagement_goal,
    create_mentions_goal,
    create_reddit_goal,
    create_daily_content_plan_goal,
)
from tools import (
    twitter_browser_task,
    reddit_browser_task,
    get_recent_history,
    is_duplicate_content,
    store_content_history,
)


class CineeCrew:
    """Autonomous crew for Cinee's social media presence.

    The Writer agent owns the CEO voice and uses browser tools to execute.
    No granular API calls — just goals and autonomous browser execution.
    """

    def __init__(self):
        self.writer = create_writer_agent()
        self.writer.tools = [
            twitter_browser_task,
            reddit_browser_task,
            get_recent_history,
            is_duplicate_content,
            store_content_history,
        ]

    def _run(self, task) -> str:
        task.agent = self.writer
        crew = Crew(
            agents=[self.writer],
            tasks=[task],
            process=Process.sequential,
            verbose=True,
        )
        return str(crew.kickoff())

    # -- Twitter workflows ---------------------------------------------------

    def amplify_ai_films(self, count: int = 3, strategy_context: str = "") -> dict:
        """Find and amplify great AI films on Twitter."""
        result = self._run(create_amplification_goal(count, strategy_context))
        return {"action": "amplification", "count": count, "result": result}

    def post_hot_take(self, strategy_context: str = "") -> dict:
        """Craft and post a hot take about the AI film industry."""
        result = self._run(create_hot_take_goal(strategy_context))
        return {"action": "hot_take", "result": result}

    def engage_creators(self, count: int = 10, strategy_context: str = "") -> dict:
        """Find AI filmmakers and engage genuinely with their work."""
        result = self._run(create_engagement_goal(count, strategy_context))
        return {"action": "engagement", "target_count": count, "result": result}

    def check_mentions(self) -> dict:
        """Check and respond to Twitter mentions."""
        result = self._run(create_mentions_goal())
        return {"action": "mentions", "result": result}

    # -- Reddit workflows -----------------------------------------------------

    def engage_reddit(self, count: int = 3, strategy_context: str = "") -> dict:
        """Participate in Reddit discussions about AI filmmaking."""
        result = self._run(create_reddit_goal(count, strategy_context))
        return {"action": "reddit", "count": count, "result": result}

    # -- Planning -------------------------------------------------------------

    def plan_daily_content(self, strategy_brief: str) -> dict:
        """Plan today's content mix based on strategy brief."""
        result = self._run(create_daily_content_plan_goal(strategy_brief))
        return {"action": "daily_plan", "result": result}

    # -- Full daily cycle -----------------------------------------------------

    def run_daily_cycle(self, strategy_brief: str = "") -> dict:
        """Execute the full daily content cycle.

        Order: plan → amplify → hot take → engage → mentions → reddit
        """
        results = {}

        if strategy_brief:
            results["plan"] = self.plan_daily_content(strategy_brief)

        results["amplification"] = self.amplify_ai_films(
            count=3, strategy_context=strategy_brief,
        )
        results["hot_take"] = self.post_hot_take(
            strategy_context=strategy_brief,
        )
        results["engagement"] = self.engage_creators(
            count=10, strategy_context=strategy_brief,
        )
        results["mentions"] = self.check_mentions()
        results["reddit"] = self.engage_reddit(
            count=3, strategy_context=strategy_brief,
        )

        return results
