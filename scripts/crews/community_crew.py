"""Community Layer Crew - Writer, Publisher, Reply."""
from crewai import Crew, Process
from agents.community import (
    create_writer_agent,
    create_publisher_agent,
    create_reply_agent,
)
from tasks.community_tasks import (
    create_content_writing_task,
    create_publishing_task,
    create_reply_drafting_task,
    create_reply_publishing_task,
    create_bulk_reply_task,
)
from tools.twitter_tools import (
    post_tweet,
    reply_to_tweet,
    get_mentions,
    like_tweet,
    retweet,
    get_tweet_details,
)
from tools.content_tools import (
    calculate_character_count,
    format_tweet,
    suggest_hashtags,
    analyze_sentiment,
)


class CommunityCrew:
    """Community Layer Crew for writing and publishing."""
    
    def __init__(self):
        """Initialize Community Crew with agents."""
        self.writer_agent = create_writer_agent()
        self.publisher_agent = create_publisher_agent()
        self.reply_agent = create_reply_agent()
        
        # Assign tools to agents
        self.writer_agent.tools = [
            calculate_character_count,
            format_tweet,
            suggest_hashtags,
            analyze_sentiment,
        ]
        
        self.publisher_agent.tools = [
            post_tweet,
            reply_to_tweet,
            get_tweet_details,
        ]
        
        self.reply_agent.tools = [
            reply_to_tweet,
            get_mentions,
            get_tweet_details,
            analyze_sentiment,
        ]
        
        self.crew = Crew(
            agents=[
                self.writer_agent,
                self.publisher_agent,
                self.reply_agent,
            ],
            tasks=[],
            process=Process.sequential,
            verbose=True,
            memory=False,  # Disabled to prevent API rate limit issues (429) with free tier tokens
        )
    
    def write_content(self, topic: str, content_type: str = "post") -> str:
        """Write content for a topic."""
        task = create_content_writing_task(topic, content_type)
        task.agent = self.writer_agent
        
        self.crew.tasks = [task]
        return self.crew.kickoff()
    
    def publish_content(self, content: str, scheduled_time: str = None) -> str:
        """Publish content to Twitter."""
        task = create_publishing_task(content, scheduled_time)
        task.agent = self.publisher_agent
        
        self.crew.tasks = [task]
        return self.crew.kickoff()
    
    def draft_reply(self, comment: str, post_context: str) -> str:
        """Draft a reply to a comment."""
        task = create_reply_drafting_task(comment, post_context)
        task.agent = self.reply_agent
        
        self.crew.tasks = [task]
        return self.crew.kickoff()
    
    def publish_reply(self, reply_text: str, tweet_id: str) -> str:
        """Publish a reply."""
        task = create_reply_publishing_task(reply_text, tweet_id)
        task.agent = self.publisher_agent
        
        self.crew.tasks = [task]
        return self.crew.kickoff()
    
    def handle_comments(self, comments: list) -> str:
        """Handle multiple comments."""
        task = create_bulk_reply_task(comments)
        task.agent = self.reply_agent
        
        self.crew.tasks = [task]
        return self.crew.kickoff()
    
    def write_and_publish(self, topic: str, content_type: str = "post") -> str:
        """Write and publish content in one flow."""
        # Write content
        write_task = create_content_writing_task(topic, content_type)
        write_task.agent = self.writer_agent
        
        # Publish content — uses CrewAI context to get write_task output
        publish_task = create_publishing_task(content="[Will use output from writing task]")
        publish_task.agent = self.publisher_agent
        publish_task.context = [write_task]
        
        self.crew.tasks = [write_task, publish_task]
        return self.crew.kickoff()
    
    def process_mentions(self) -> str:
        """Process and reply to mentions."""
        from tools.twitter_tools import get_mentions
        
        # Get mentions first
        mentions = get_mentions._run(max_results=10)
        
        if not mentions or "error" in mentions[0]:
            return "No new mentions to process"
        
        # Process each mention
        tasks = []
        for mention in mentions[:5]:  # Limit to 5 at a time
            reply_task = create_reply_drafting_task(
                comment=mention.get("text", ""),
                post_context=f"Tweet ID: {mention.get('tweet_id')}"
            )
            reply_task.agent = self.reply_agent
            tasks.append(reply_task)
        
        self.crew.tasks = tasks
        return self.crew.kickoff()
