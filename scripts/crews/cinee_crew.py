"""Cinee-specific Crew for AI filmmaker community engagement."""
from crewai import Crew, Process, Agent
from agents.execution import create_curator_agent, create_engage_agent, create_hottake_agent
from agents.community import create_writer_agent, create_publisher_agent, create_reply_agent
from tasks.cinee_tasks import (
    create_ai_film_curation_task,
    create_hot_take_task,
    create_cinee_engagement_task,
    create_reddit_discussion_task,
    create_reddit_engagement_task,
    create_daily_content_mix_task,
    create_creator_outreach_task,
)
from tools.cinee_tools import (
    find_ai_films_to_amplify,
    draft_amplification_comment,
    find_creator_engagement_opportunities,
    generate_hot_take_topics,
    get_daily_engagement_targets,
)
from tools.twitter_tools import (
    search_tweets,
    quote_tweet,
    reply_to_tweet,
    get_tweet_details,
)
from tools.reddit_tools import (
    monitor_ai_film_subreddits,
    find_discussion_opportunities,
    create_reddit_post,
    reply_to_reddit_post,
)
from config.settings import settings


class CineeCrew:
    """Cinee-specific crew for AI filmmaker engagement.
    
    Daily workflow:
    1. Curate AI films to amplify (quote-tweet great work)
    2. Share hot takes on industry problems
    3. Engage genuinely with AI filmmakers
    4. Participate in Reddit discussions
    """
    
    def __init__(self):
        """Initialize Cinee Crew."""
        # Reuse agents from execution and community layers
        self.curator = create_curator_agent()
        self.engager = create_engage_agent()
        self.hot_taker = create_hottake_agent()
        self.writer = create_writer_agent()
        self.publisher = create_publisher_agent()
        self.replier = create_reply_agent()
        
        # Assign Cinee-specific tools
        self.curator.tools = [
            find_ai_films_to_amplify,
            search_tweets,
            get_tweet_details,
        ]
        
        self.engager.tools = [
            find_creator_engagement_opportunities,
            draft_amplification_comment,
            reply_to_tweet,
        ]
        
        self.hot_taker.tools = [
            generate_hot_take_topics,
        ]
        
        self.publisher.tools = [
            quote_tweet,
            reply_to_tweet,
        ]
        
        self.crew = Crew(
            agents=[self.curator, self.engager, self.hot_taker, self.writer, self.publisher, self.replier],
            tasks=[],
            process=Process.sequential,
            verbose=True,
            memory=False,
        )
    
    def run_daily_amplification(self) -> str:
        """Run daily AI film amplification workflow.
        
        Find great AI films and quote-tweet with genuine commentary.
        """
        # Find films to amplify
        curation_task = create_ai_film_curation_task()
        curation_task.agent = self.curator
        
        # Draft amplification posts
        write_task = create_ai_film_curation_task()
        write_task.agent = self.writer
        write_task.context = [curation_task]
        
        self.crew.tasks = [curation_task, write_task]
        return self.crew.kickoff()
    
    def run_hot_take(self) -> str:
        """Generate and post a hot take on AI film industry."""
        # Generate hot take
        hot_take_task = create_hot_take_task()
        hot_take_task.agent = self.hot_taker
        
        # Polish for Twitter
        write_task = create_hot_take_task()
        write_task.agent = self.writer
        write_task.context = [hot_take_task]
        
        self.crew.tasks = [hot_take_task, write_task]
        return self.crew.kickoff()
    
    def run_engagement(self, keywords: list = None) -> str:
        """Run engagement with AI filmmakers.
        
        Find creators posting AI films and engage genuinely.
        Never pitch Cinee - just be present.
        """
        engagement_task = create_cinee_engagement_task(keywords or settings.role.engagement_keywords)
        engagement_task.agent = self.engager
        
        self.crew.tasks = [engagement_task]
        return self.crew.kickoff()
    
    def run_reddit_discussion(self) -> str:
        """Start or participate in Reddit discussions.
        
        Strategy: Don't promote directly, let conversation lead to Cinee.
        """
        # Find discussion opportunities
        reddit_task = create_reddit_discussion_task()
        reddit_task.agent = self.engager
        
        # Draft post
        write_task = create_reddit_discussion_task()
        write_task.agent = self.writer
        write_task.context = [reddit_task]
        
        self.crew.tasks = [reddit_task, write_task]
        return self.crew.kickoff()
    
    def run_daily_content_mix(self) -> str:
        """Plan and execute daily content mix.
        
        Mix: 2-3 amplifications, 1 hot take, 5-10 replies.
        """
        # Plan the day
        planning_task = create_daily_content_mix_task()
        planning_task.agent = self.curator
        
        # Execute amplifications
        curation_task = create_ai_film_curation_task()
        curation_task.agent = self.curator
        curation_task.context = [planning_task]
        
        # Execute hot take
        hot_take_task = create_hot_take_task()
        hot_take_task.agent = self.hot_taker
        hot_take_task.context = [planning_task]
        
        # Execute engagement
        engagement_task = create_cinee_engagement_task()
        engagement_task.agent = self.engager
        engagement_task.context = [planning_task]
        
        self.crew.tasks = [planning_task, curation_task, hot_take_task, engagement_task]
        return self.crew.kickoff()
    
    def run_creator_outreach(self) -> str:
        """Identify and plan outreach to key AI filmmakers."""
        outreach_task = create_creator_outreach_task()
        outreach_task.agent = self.engager
        
        self.crew.tasks = [outreach_task]
        return self.crew.kickoff()


class CineeTwitterWorkflow:
    """Twitter-specific workflow for Cinee.
    
    Daily tasks:
    1. Amplify 2-3 great AI films (quote-tweet with genuine commentary)
    2. Share 1 hot take on industry problems
    3. Reply to 5-10 AI filmmaker posts (genuine engagement, no pitch)
    """
    
    def __init__(self):
        self.crew = CineeCrew()
    
    def amplify_ai_films(self, count: int = 3) -> dict:
        """Find and amplify great AI films.
        
        Returns list of amplified posts with creator info.
        """
        result = self.crew.run_daily_amplification()
        return {
            "action": "amplification",
            "count": count,
            "result": str(result)
        }
    
    def share_hot_take(self) -> dict:
        """Generate and share a hot take."""
        result = self.crew.run_hot_take()
        return {
            "action": "hot_take",
            "result": str(result)
        }
    
    def engage_creators(self, count: int = 10) -> dict:
        """Engage genuinely with AI filmmakers."""
        result = self.crew.run_engagement()
        return {
            "action": "engagement",
            "target_count": count,
            "result": str(result)
        }


class CineeRedditWorkflow:
    """Reddit-specific workflow for Cinee.
    
    Strategy: Don't promote directly. Start discussions that naturally lead to Cinee.
    """
    
    def __init__(self):
        self.crew = CineeCrew()
        self.target_subreddits = settings.role.communities
    
    def start_discussion(self, subreddit: str = None) -> dict:
        """Start a discussion in target subreddit."""
        result = self.crew.run_reddit_discussion()
        return {
            "action": "reddit_discussion",
            "subreddit": subreddit or self.target_subreddits[0],
            "result": str(result)
        }
    
    def engage_discussions(self, count: int = 5) -> dict:
        """Find and engage in relevant discussions."""
        opportunities = find_discussion_opportunities._run()
        return {
            "action": "reddit_engagement",
            "opportunities": opportunities[:count]
        }
    
    def monitor_communities(self) -> dict:
        """Monitor all AI film communities for relevant content."""
        posts = monitor_ai_film_subreddits._run()
        return {
            "action": "community_monitoring",
            "posts_found": len(posts),
            "top_posts": posts[:5]
        }
