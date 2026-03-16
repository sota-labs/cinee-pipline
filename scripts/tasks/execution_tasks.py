"""Execution Layer Tasks — pure planning and thinking."""
from crewai import Task


def create_content_planning_task(strategy_brief: str) -> Task:
    """Task for creating a content plan from a strategy brief."""
    return Task(
        description=f"""Based on the strategy brief, create a detailed
        content plan for the next 24-48 hours:

        Strategy Brief: {strategy_brief}

        Include:
        1. Specific topics to cover
        2. Recommended posting times
        3. Content types (amplification, hot take, engagement, reddit)
        4. Priority order
        5. What to avoid (recent duplicates, overused angles)

        Output a structured content calendar.""",
        expected_output="A structured content calendar with topics, times, and priorities",
        agent=None,
    )


def create_daily_briefing_task() -> Task:
    """Task for creating a daily briefing."""
    return Task(
        description="""Create a daily briefing for content activities:

        1. Summary of yesterday's performance (check recent history)
        2. Today's priorities
        3. Key topics to address
        4. Engagement focus areas
        5. Any urgent matters

        Output a concise briefing document.""",
        expected_output="Daily briefing document with priorities and opportunities",
        agent=None,
    )
