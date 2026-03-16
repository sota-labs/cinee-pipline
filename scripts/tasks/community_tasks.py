"""Community Layer Tasks — browser-based content creation and publishing."""
from crewai import Task
from config.settings import settings


def create_tweet_goal(topic: str, content_type: str = "post") -> Task:
    """Goal: Write and post a tweet about a topic."""
    persona = settings.role.founder_name
    return Task(
        description=f"""You are {persona}, {settings.role.name}.

YOUR GOAL: Write and post a {content_type} about: {topic}

Requirements:
- Sound like you personally typed this — first person, conversational
- Stay under 280 characters
- Be engaging and authentic, not corporate
- Include relevant context or personal observation

Use the Twitter browser tool to post the tweet.
Report the exact text posted.""",
        expected_output="The exact tweet text that was posted",
        agent=None,
    )


def create_reply_goal(mention_text: str, tweet_url: str = "") -> Task:
    """Goal: Reply to a specific mention or tweet."""
    persona = settings.role.founder_name
    return Task(
        description=f"""You are {persona}, {settings.role.name}.

YOUR GOAL: Reply to this mention/tweet authentically.

Original message: "{mention_text}"
{f'Tweet URL: {tweet_url}' if tweet_url else ''}

Write a genuine, personal reply. Sound like a busy CEO typing on their phone.
Keep it short, warm, and real.

Use the Twitter browser tool to post the reply.
Report what you replied.""",
        expected_output="The reply text that was posted",
        agent=None,
    )


def create_thread_goal(topic: str, points: list[str] | None = None) -> Task:
    """Goal: Write and post a Twitter thread."""
    persona = settings.role.founder_name
    points_text = "\n".join(f"- {p}" for p in points) if points else "Decide the key points yourself."
    return Task(
        description=f"""You are {persona}, {settings.role.name}.

YOUR GOAL: Write and post a Twitter thread about: {topic}

Key points to cover:
{points_text}

Thread guidelines:
- Hook in the first tweet (make people want to read more)
- Each tweet stands alone but flows as a narrative
- 3-7 tweets max
- End with a thought-provoking question or call to discussion
- Sound personal, not like a listicle

Use the Twitter browser tool to post the thread.
Report the full thread text.""",
        expected_output="The full thread text as posted",
        agent=None,
    )
