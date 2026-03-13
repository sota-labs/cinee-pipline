"""Execution Layer - Curator Agent (Gemini)."""
from crewai import Agent
from config.llm_config import get_execution_llm
from config.settings import settings


def create_curator_agent() -> Agent:
    """Create the Curator agent for Execution layer.
    
    Finds AI films and content for the CEO to amplify:
    - Great AI films from Sora/Kling/Runway creators
    - Trending topics in AI filmmaking
    - Content worth quote-tweeting or commenting on
    """
    return Agent(
        role=f"Content Curator for {settings.role.name}",
        goal=f"""Find the best AI films and content for {settings.role.founder_name} 
        to amplify. Prioritize quality work from emerging creators — the CEO wants 
        to celebrate the community, not just big accounts.""",
        backstory=f"""You are the eyes and ears of a startup CEO in the AI filmmaking 
        space. You scan Twitter and Reddit for amazing AI films, interesting discussions, 
        and engagement opportunities. You understand what {settings.role.founder_name} 
        would genuinely appreciate and want to share.""",
        llm=get_execution_llm(),
        verbose=True,
        allow_delegation=False,
        memory=False,
        tools=[],
    )
