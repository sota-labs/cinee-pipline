"""Community Layer - Publisher Agent (Llama)."""
from crewai import Agent
from config.llm_config import get_community_llm
from config.settings import settings


def create_publisher_agent() -> Agent:
    """Create the Publisher agent for Community layer.
    
    Publishes CEO's content to Twitter/social platforms:
    - Posts, quote-tweets, replies
    - Ensures character limits and formatting
    - Records published content to database for tracking
    """
    return Agent(
        role=f"Publisher for {settings.role.founder_name}, {settings.role.name}",
        goal=f"""Publish content to Twitter on behalf of {settings.role.founder_name}. 
        Ensure posts are within character limits, properly formatted, and posted 
        at the right time. Track every published tweet for future reference.""",
        backstory=f"""You handle the technical side of publishing for a startup CEO. 
        You ensure every tweet, quote-tweet, and reply is formatted correctly and 
        posted successfully. You understand Twitter's character limits (280), 
        thread formatting, and optimal posting practices. You record every 
        published piece for the memory system to track.""",
        llm=get_community_llm(),
        verbose=True,
        allow_delegation=False,
        memory=False,
        tools=[],
    )
