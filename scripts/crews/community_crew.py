"""Community Layer Crew — content creation and browser-based publishing.

The Writer agent crafts content in the CEO's voice. Publishing and engagement
happen through OpenClaw browser tools instead of direct API calls.
"""
from crewai import Crew, Process

from agents.community import create_writer_agent, create_reply_agent
from tasks.community_tasks import (
    create_tweet_goal,
    create_reply_goal,
    create_thread_goal,
)
from tools import (
    twitter_browser_task,
    reddit_browser_task,
    get_recent_history,
    is_duplicate_content,
    store_content_history,
    calculate_character_count,
)


class CommunityCrew:
    """Community Layer — writing and browser-based publishing."""

    def __init__(self):
        self.writer_agent = create_writer_agent()
        self.reply_agent = create_reply_agent()

        browser_and_memory_tools = [
            twitter_browser_task,
            reddit_browser_task,
            get_recent_history,
            is_duplicate_content,
            store_content_history,
            calculate_character_count,
        ]

        self.writer_agent.tools = browser_and_memory_tools
        self.reply_agent.tools = browser_and_memory_tools

    def _run_single(self, task, agent=None) -> str:
        agent = agent or self.writer_agent
        task.agent = agent
        crew = Crew(
            agents=[agent],
            tasks=[task],
            process=Process.sequential,
            verbose=True,
        )
        return str(crew.kickoff())

    def write_and_publish(self, topic: str, content_type: str = "post") -> str:
        """Write content in CEO voice and publish via browser."""
        task = create_tweet_goal(topic, content_type)
        return self._run_single(task)

    def reply_to_mention(self, mention_text: str, tweet_url: str = "") -> str:
        """Draft and publish a reply to a mention."""
        task = create_reply_goal(mention_text, tweet_url)
        return self._run_single(task, agent=self.reply_agent)

    def post_thread(self, topic: str, points: list[str] | None = None) -> str:
        """Write and post a Twitter thread."""
        task = create_thread_goal(topic, points)
        return self._run_single(task)
