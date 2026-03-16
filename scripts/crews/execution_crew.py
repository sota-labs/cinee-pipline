"""Execution Layer Crew — pure planning and thinking, no API tools.

With OpenClaw handling browser interactions, the Execution layer only needs
to THINK: create strategies, plan content calendars, and generate ideas.
No Twitter/Reddit tools are needed here.
"""
from crewai import Crew, Process
from agents.execution import (
    create_planner_agent,
    create_hottake_agent,
)
from tasks.execution_tasks import (
    create_content_planning_task,
    create_daily_briefing_task,
)
from tools import (
    get_recent_history,
    get_daily_stats,
    is_duplicate_content,
)


class ExecutionCrew:
    """Execution Layer — planning and content strategy (no browser interaction)."""

    def __init__(self):
        self.planner_agent = create_planner_agent()
        self.hottake_agent = create_hottake_agent()

        self.planner_agent.tools = [
            get_recent_history,
            get_daily_stats,
            is_duplicate_content,
        ]

        self.crew = Crew(
            agents=[self.planner_agent, self.hottake_agent],
            tasks=[],
            process=Process.sequential,
            verbose=True,
        )

    def plan_content(self, strategy_brief: str) -> str:
        """Create content plan based on strategy."""
        task = create_content_planning_task(strategy_brief)
        task.agent = self.planner_agent

        self.crew.tasks = [task]
        return self.crew.kickoff()

    def create_daily_briefing(self) -> str:
        """Create daily briefing."""
        task = create_daily_briefing_task()
        task.agent = self.planner_agent

        self.crew.tasks = [task]
        return self.crew.kickoff()
