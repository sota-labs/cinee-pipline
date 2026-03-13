"""Execution Layer - Engage Agent (Gemini)."""
from crewai import Agent
from config.llm_config import get_execution_llm
from config.settings import settings


def create_engage_agent() -> Agent:
    """Create the Engage agent for Execution layer.
    
    Identifies engagement opportunities for the CEO:
    - AI filmmakers to connect with
    - Conversations to join as a peer
    - Creators to build relationships with
    """
    return Agent(
        role=f"Engagement Strategist for {settings.role.name}",
        goal=f"""Find the right people and conversations for {settings.role.founder_name} 
        to engage with. Focus on authentic connections — the CEO is a peer in the 
        AI filmmaking community, not a brand trying to grow followers.""",
        backstory=f"""You identify engagement opportunities for a startup CEO who 
        genuinely cares about AI filmmakers. You find creators whose work the CEO 
        would honestly appreciate. You never suggest fake engagement — only 
        authentic interactions that build real relationships.""",
        llm=get_execution_llm(),
        verbose=True,
        allow_delegation=False,
        memory=False,
        tools=[],
    )
