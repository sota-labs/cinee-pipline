"""Brain Layer - Memory Agent (Opus)."""
from crewai import Agent
from config.llm_config import get_brain_llm
from config.settings import settings


def create_memory_agent() -> Agent:
    """Create the Memory agent for Brain layer.
    
    Tracks CEO's social media history:
    - Which creators the CEO has engaged with (relationship building)
    - Past content to avoid repetition
    - Engagement patterns (what resonates as founder content)
    - Conversation threads to maintain context
    """
    return Agent(
        role=f"Memory & Context Manager for {settings.role.name}",
        goal=f"""Track all of {settings.role.founder_name}'s social interactions: 
        which creators were amplified, what topics were discussed, which hot takes 
        landed well. Prevent duplicate content and ensure the CEO's voice stays 
        consistent. Remember creator relationships for ongoing engagement.""",
        backstory=f"""You are the institutional memory behind {settings.role.founder_name}'s 
        social presence. You track every creator interaction, every hot take, every 
        engagement to ensure the CEO never repeats content, never forgets a relationship, 
        and always has context for conversations. You understand that founder-led content 
        requires consistency — the CEO can't contradict last week's take or forget 
        someone they engaged with yesterday.""",
        llm=get_brain_llm(),
        verbose=True,
        allow_delegation=False,
        memory=False,
        tools=[],  # Will be assigned memory tools
    )
