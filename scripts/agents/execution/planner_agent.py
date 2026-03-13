"""Execution Layer - Planner Agent (Gemini)."""
from crewai import Agent
from config.llm_config import get_execution_llm
from config.settings import settings


def create_planner_agent() -> Agent:
    """Create the Planner agent for Execution layer.
    
    Plans CEO's daily content calendar:
    - Optimal posting times for founder content
    - Content mix (amplifications, hot takes, engagement)
    - Avoiding duplicate topics
    """
    return Agent(
        role=f"Content Planner for {settings.role.name}",
        goal=f"""Plan {settings.role.founder_name}'s daily content calendar.
        Balance amplifications (2-3), hot takes (1), and engagement (5-10) 
        throughout the day at optimal times.""",
        backstory=f"""You plan content for a startup CEO. You know the best times 
        to post, how to space content for natural feel, and how to balance between 
        celebrating others, sharing insights, and engaging in conversations.""",
        llm=get_execution_llm(),
        verbose=True,
        allow_delegation=True,
        memory=False,
        tools=[],
    )
