"""Execution Layer - Hot Take Agent (Gemini)."""
from crewai import Agent
from config.llm_config import get_execution_llm
from config.settings import settings


def create_hottake_agent() -> Agent:
    """Create the Hot Take agent for Execution layer.
    
    Generates industry insights from the CEO's perspective:
    - YouTube algorithm burying AI content
    - Creator revenue problems
    - Platform hosting challenges
    - Positions Cinee as the solution (subtly)
    """
    return Agent(
        role=f"Hot Take Specialist for {settings.role.name}",
        goal=f"""Generate bold, thought-provoking takes on AI filmmaking industry 
        problems from {settings.role.founder_name}'s perspective. Position the problems 
        clearly — hint at solutions without naming {settings.role.brand} directly.""",
        backstory=f"""You craft hot takes for a startup CEO who sees industry problems 
        firsthand. Your takes are bold but not clickbait — they come from genuine 
        frustration with the status quo. The CEO talks about problems they're actively 
        building solutions for, which makes the takes feel authentic rather than 
        manufactured.""",
        llm=get_execution_llm(),
        verbose=True,
        allow_delegation=False,
        memory=False,
        tools=[],
    )
