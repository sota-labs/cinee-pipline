"""Execution Layer Tasks."""
from crewai import Task
from typing import List, Dict, Any


def create_content_planning_task(strategy_brief: str) -> Task:
    """Task for creating content plan."""
    return Task(
        description=f"""Based on the strategy brief, create a detailed 
        content plan for the next 24-48 hours:
        
        Strategy Brief: {strategy_brief}
        
        Include:
        1. Specific topics to cover
        2. Recommended posting times
        3. Content types (insight, hot take, engagement, etc.)
        4. Priority order
        
        Output a structured content calendar.""",
        expected_output="A structured content calendar with topics, times, and priorities",
        agent=None,
    )


def create_curation_task(topic: str = None) -> Task:
    """Task for curating content opportunities."""
    return Task(
        description=f"""Curate content opportunities for today.
        {f'Focus area: {topic}' if topic else ''}
        
        Find:
        1. Trending topics relevant to the role
        2. Industry news and developments
        3. Conversation opportunities
        4. Content gaps to fill
        
        Provide a list of curated opportunities with relevance scores.""",
        expected_output="List of curated content opportunities with relevance scores",
        agent=None,
    )


def create_engagement_opportunity_task() -> Task:
    """Task for identifying engagement opportunities."""
    return Task(
        description="""Identify strategic engagement opportunities:
        
        1. Accounts to interact with (peers, thought leaders, partners)
        2. Conversations to join
        3. Questions to answer
        4. Content to amplify
        
        Prioritize opportunities by potential impact and relevance.""",
        expected_output="Prioritized list of engagement opportunities",
        agent=None,
    )


def create_hottake_task(trending_topic: str) -> Task:
    """Task for generating a hot take on trending topic."""
    return Task(
        description=f"""Generate a thought-provoking hot take on this 
        trending topic: {trending_topic}
        
        Requirements:
        1. Reflect the role's unique perspective
        2. Be bold but not controversial
        3. Spark meaningful discussion
        4. Stay professionally appropriate
        
        Output a draft hot take with reasoning.""",
        expected_output="Draft hot take with supporting reasoning",
        agent=None,
    )


def create_daily_briefing_task() -> Task:
    """Task for creating daily briefing."""
    return Task(
        description="""Create a daily briefing for content activities:
        
        1. Summary of yesterday's performance
        2. Today's priorities
        3. Key topics to address
        4. Engagement opportunities
        5. Any urgent matters
        
        Output a concise briefing document.""",
        expected_output="Daily briefing document with priorities and opportunities",
        agent=None,
    )
