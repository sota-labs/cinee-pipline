"""Brain Layer Crew - Strategy + Memory."""
from crewai import Crew, Process
from agents.brain import create_strategy_agent, create_memory_agent
from tasks.brain_tasks import (
    create_strategy_analysis_task,
    create_memory_retrieval_task,
    create_memory_store_task,
    create_strategy_review_task,
)
from tools.memory_tools import (
    store_memory,
    retrieve_memory,
    search_memories,
    store_content_history,
    get_recent_history,
    store_engagement_pattern,
    get_engagement_patterns,
)


class BrainCrew:
    """Brain Layer Crew for strategy and memory management."""
    
    def __init__(self):
        """Initialize Brain Crew with agents."""
        self.strategy_agent = create_strategy_agent()
        self.memory_agent = create_memory_agent()
        
        # Assign tools to agents
        self.memory_agent.tools = [
            store_memory,
            retrieve_memory,
            search_memories,
            store_content_history,
            get_recent_history,
            store_engagement_pattern,
            get_engagement_patterns,
        ]
        
        self.crew = Crew(
            agents=[self.strategy_agent, self.memory_agent],
            tasks=[],
            process=Process.sequential,
            verbose=True,
            memory=False,  # Disabled to prevent API rate limit issues (429) with free tier tokens
        )
    
    def analyze_strategy(self, context: dict = None) -> str:
        """Run strategy analysis."""
        task = create_strategy_analysis_task(context=context)
        task.agent = self.strategy_agent
        
        self.crew.tasks = [task]
        return self.crew.kickoff()
    
    def retrieve_context(self, query: str) -> str:
        """Retrieve relevant context from memory."""
        task = create_memory_retrieval_task(query)
        task.agent = self.memory_agent
        
        self.crew.tasks = [task]
        return self.crew.kickoff()
    
    def store_memory_data(self, content_type: str, content: str, metadata: dict = None) -> str:
        """Store new memory data."""
        task = create_memory_store_task(content_type, content, metadata)
        task.agent = self.memory_agent
        
        self.crew.tasks = [task]
        return self.crew.kickoff()
    
    def review_content(self, content: str) -> str:
        """Review content against strategy."""
        task = create_strategy_review_task(content)
        task.agent = self.strategy_agent
        
        self.crew.tasks = [task]
        return self.crew.kickoff()
    
    def run_daily_strategy(self) -> str:
        """Run daily strategy planning."""
        # First retrieve relevant context
        context_task = create_memory_retrieval_task("recent content performance and engagement patterns")
        context_task.agent = self.memory_agent
        
        # Then analyze strategy
        strategy_task = create_strategy_analysis_task()
        strategy_task.agent = self.strategy_agent
        strategy_task.context = [context_task]
        
        self.crew.tasks = [context_task, strategy_task]
        return self.crew.kickoff()
