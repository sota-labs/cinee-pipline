"""Execution Layer Crew - Planner, Curator, Engage, Hot Take."""
from crewai import Crew, Process
from agents.execution import (
    create_planner_agent,
    create_curator_agent,
    create_engage_agent,
    create_hottake_agent,
)
from tasks.execution_tasks import (
    create_content_planning_task,
    create_curation_task,
    create_engagement_opportunity_task,
    create_hottake_task,
    create_daily_briefing_task,
)
from tools.content_tools import (
    generate_content_ideas,
    optimize_posting_time,
    suggest_hashtags,
)
from tools.twitter_tools import (
    get_trending_topics,
    search_tweets,
)


class ExecutionCrew:
    """Execution Layer Crew for planning and curation."""
    
    def __init__(self):
        """Initialize Execution Crew with agents."""
        self.planner_agent = create_planner_agent()
        self.curator_agent = create_curator_agent()
        self.engage_agent = create_engage_agent()
        self.hottake_agent = create_hottake_agent()
        
        # Assign tools to agents
        self.curator_agent.tools = [
            get_trending_topics,
            search_tweets,
            generate_content_ideas,
        ]
        
        self.planner_agent.tools = [
            optimize_posting_time,
            suggest_hashtags,
        ]
        
        self.engage_agent.tools = [
            search_tweets,
        ]
        
        self.crew = Crew(
            agents=[
                self.planner_agent,
                self.curator_agent,
                self.engage_agent,
                self.hottake_agent,
            ],
            tasks=[],
            process=Process.sequential,
            verbose=True,
            memory=False,  # Disabled to prevent API rate limit issues (429) with free tier tokens
        )
    
    def plan_content(self, strategy_brief: str) -> str:
        """Create content plan based on strategy."""
        task = create_content_planning_task(strategy_brief)
        task.agent = self.planner_agent
        
        self.crew.tasks = [task]
        return self.crew.kickoff()
    
    def curate_topics(self, topic: str = None) -> str:
        """Curate content opportunities."""
        task = create_curation_task(topic)
        task.agent = self.curator_agent
        
        self.crew.tasks = [task]
        return self.crew.kickoff()
    
    def find_engagement_opportunities(self) -> str:
        """Identify engagement opportunities."""
        task = create_engagement_opportunity_task()
        task.agent = self.engage_agent
        
        self.crew.tasks = [task]
        return self.crew.kickoff()
    
    def generate_hottake(self, trending_topic: str) -> str:
        """Generate hot take on trending topic."""
        task = create_hottake_task(trending_topic)
        task.agent = self.hottake_agent
        
        self.crew.tasks = [task]
        return self.crew.kickoff()
    
    def create_daily_briefing(self) -> str:
        """Create daily briefing."""
        # Curation first
        curation_task = create_curation_task()
        curation_task.agent = self.curator_agent
        
        # Engagement opportunities
        engagement_task = create_engagement_opportunity_task()
        engagement_task.agent = self.engage_agent
        
        # Final briefing
        briefing_task = create_daily_briefing_task()
        briefing_task.agent = self.planner_agent
        briefing_task.context = [curation_task, engagement_task]
        
        self.crew.tasks = [curation_task, engagement_task, briefing_task]
        return self.crew.kickoff()
    
    def run_content_cycle(self, strategy_brief: str) -> str:
        """Run full content cycle: plan -> curate -> engage."""
        plan_task = create_content_planning_task(strategy_brief)
        plan_task.agent = self.planner_agent
        
        curate_task = create_curation_task()
        curate_task.agent = self.curator_agent
        curate_task.context = [plan_task]
        
        engage_task = create_engagement_opportunity_task()
        engage_task.agent = self.engage_agent
        engage_task.context = [plan_task]
        
        self.crew.tasks = [plan_task, curate_task, engage_task]
        return self.crew.kickoff()
