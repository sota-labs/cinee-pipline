"""Goal-oriented tasks for Cinee's autonomous social media operations.

Each task describes a HIGH-LEVEL GOAL. The agent + OpenClaw browser automation
figures out the details (what to search, which posts to pick, how to interact).
"""
from crewai import Task
from config.settings import settings


def create_amplification_goal(count: int = 3, strategy_context: str = "") -> Task:
    """Goal: Find and amplify great AI films on Twitter."""
    persona = settings.role.founder_name
    return Task(
        description=f"""You are {persona}, {settings.role.name}.

YOUR GOAL: Find {count} impressive AI films on Twitter and amplify them with
genuine, personal commentary.

Use the Twitter browser tool to accomplish this. The browser agent will handle
navigation and interaction — you decide WHAT to amplify and WHAT to say.

Guidelines for finding films:
- Look for AI-generated films/videos made with Sora, Kling, Runway, or similar
- Prioritise quality and creativity over follower count
- Favour emerging creators over big accounts
- Pick films posted in the last 24-48 hours

Guidelines for your commentary (quote-tweet):
- Be specific about what impresses you in the work
- Sound like you personally typed this between meetings
- Keep each quote-tweet under 280 characters
- Never mention or pitch {settings.role.brand}

{f'Today strategy focus: {strategy_context}' if strategy_context else ''}

Before amplifying, check recent history to avoid the same creator twice in 48h.
After completing, report exactly what you amplified and why you chose each one.""",
        expected_output="Summary of AI films amplified: creator handles, content description, and your commentary for each",
        agent=None,
    )


def create_hot_take_goal(strategy_context: str = "") -> Task:
    """Goal: Craft and post a hot take about the AI film industry."""
    persona = settings.role.founder_name
    return Task(
        description=f"""You are {persona}, {settings.role.name}.

YOUR GOAL: Write and post ONE bold hot take about the AI film industry.

Think about problems you see firsthand as a builder in this space:
- YouTube's algorithm burying AI content
- Creator revenue and monetisation gaps
- Platform limitations for AI filmmakers
- The gap between AI generation tools and distribution
- Why AI filmmakers need dedicated infrastructure

Your take should:
- Come from genuine founder frustration, not manufactured outrage
- Spark meaningful discussion in the replies
- Be bold but not clickbait
- Stay under 280 characters
- Hint at the problem without naming {settings.role.brand}

{f'Today strategy focus: {strategy_context}' if strategy_context else ''}

Check recent history to make sure you haven't posted a similar angle recently.
Use the Twitter browser tool to post the tweet.
Report the exact text you posted.""",
        expected_output="The exact hot take text posted on Twitter",
        agent=None,
    )


def create_engagement_goal(count: int = 10, strategy_context: str = "") -> Task:
    """Goal: Find and engage genuinely with AI filmmakers on Twitter."""
    persona = settings.role.founder_name
    keywords = ", ".join(settings.role.engagement_keywords)
    return Task(
        description=f"""You are {persona}, {settings.role.name}.

YOUR GOAL: Find {count} AI filmmakers on Twitter and engage genuinely with
their work. Use the Twitter browser tool — it will figure out how to search
and navigate.

What to look for: creators posting AI films or discussing AI filmmaking.
Relevant topics include: {keywords}

How to engage:
- Reply with genuine, specific appreciation for their work
- Ask thoughtful questions about their creative process
- Share observations as a fellow AI film enthusiast
- Vary your responses — never repeat the same phrases
- Focus on emerging creators, not just big accounts

IMPORTANT:
- Do NOT pitch anything. Just be present and authentic.
- Do NOT use generic compliments like "Great work!" — be specific.
- Sound like a busy CEO who genuinely stopped scrolling because this was good.

{f'Today strategy focus: {strategy_context}' if strategy_context else ''}

Report who you engaged with, what their content was about, and what you said.""",
        expected_output="List of creators engaged: their handle, content topic, and your reply for each",
        agent=None,
    )


def create_mentions_goal() -> Task:
    """Goal: Check and respond to Twitter mentions."""
    persona = settings.role.founder_name
    return Task(
        description=f"""You are {persona}, {settings.role.name}.

YOUR GOAL: Check your Twitter notifications for new mentions and respond
authentically to each one.

Use the Twitter browser tool to go to notifications and handle them.

Response style by context:
- To creators sharing work: genuine appreciation and curiosity
- To questions about AI filmmaking: direct, helpful answers
- To criticism: thoughtful, non-defensive, curious
- To supporters: warm gratitude without being over-the-top

Sound like a busy CEO who took 30 seconds to genuinely reply on their phone.
Never use corporate language like "Thank you for your feedback."

Report what mentions you found and how you responded to each.""",
        expected_output="Summary of mentions handled: who mentioned you, context, and your response",
        agent=None,
    )


def create_reddit_goal(count: int = 3, strategy_context: str = "") -> Task:
    """Goal: Participate in Reddit discussions about AI filmmaking."""
    persona = settings.role.founder_name
    communities = ", ".join(settings.role.communities)
    return Task(
        description=f"""You are {persona}, {settings.role.name}.

YOUR GOAL: Find and participate in {count} relevant Reddit discussions.
Target communities: {communities}

Use the Reddit browser tool — it will navigate the subreddits for you.

What to look for:
- Posts asking about hosting or distributing AI films
- Monetisation discussions for AI content creators
- Platform comparison threads
- Creator challenges and frustrations
- General AI filmmaking community conversations

How to participate:
- Share your perspective as someone building in this space
- Be genuinely helpful — answer questions with real substance
- Only mention {settings.role.brand} if someone specifically asks about alternatives
- If no good existing discussions, start one:
  "Where are you guys actually hosting your AI films?"
  "How are AI filmmakers monetising their work?"

CRITICAL: Reddit HATES promotion. Be a community member first, always.

{f'Today strategy focus: {strategy_context}' if strategy_context else ''}

Report which discussions you joined and what you contributed.""",
        expected_output="Summary of Reddit discussions: subreddit, topic, and your contribution for each",
        agent=None,
    )


def create_daily_content_plan_goal(strategy_brief: str) -> Task:
    """Goal: Plan today's content mix across Twitter and Reddit."""
    persona = settings.role.founder_name
    return Task(
        description=f"""You are {persona}, {settings.role.name}.

Based on today's strategy brief, plan the content activities for the day.

STRATEGY BRIEF:
{strategy_brief}

Create a concrete plan covering:
1. AI Film Amplification (2-3 quote-tweets): what types of films to seek out
2. Hot Take (1 tweet): which industry problem to address today
3. Engagement (5-10 replies): focus areas for creator engagement
4. Reddit (2-3 discussions): which communities and topics to engage with

Consider:
- What topics are trending in AI filmmaking right now
- What you've posted recently (avoid repetition)
- Balance between amplification, opinions, and engagement
- Time of day and optimal posting windows""",
        expected_output="Daily content plan with specific actions, focus areas, and timing",
        agent=None,
    )
