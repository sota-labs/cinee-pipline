"""Cinee-specific tasks for AI filmmaker community engagement."""
from crewai import Task
from typing import List, Dict, Any


def create_ai_film_curation_task() -> Task:
    """Task for curating and amplifying great AI films.
    
    Strategy: Quote-tweet or screenshot great work with genuine commentary.
    Creators notice when you amplify them - builds goodwill and first users.
    """
    return Task(
        description="""Find and curate the best AI films being shared on Twitter.
        
        Search for posts containing: Sora, Kling, Runway, AI film, AI video, generative video.
        
        For each great piece you find:
        1. Evaluate the quality and creativity
        2. Draft genuine, appreciative commentary (NOT salesy)
        3. Suggest quote-tweet format that amplifies the creator
        4. Never pitch Cinee directly - just celebrate the work
        
        Output: List of 3-5 AI films to amplify with suggested commentary.""",
        expected_output="List of AI films to amplify with genuine commentary for quote-tweets",
        agent=None,
    )


def create_hot_take_task() -> Task:
    """Task for generating hot takes on AI film industry problems.
    
    Strategy: Position Cinee as the solution without being salesy.
    Topics: YouTube algorithm, creator revenue, hosting challenges.
    """
    return Task(
        description="""Generate a thought-provoking hot take on the AI film space.
        
        Choose from these angles (or find your own):
        - "Why YouTube's algorithm buries AI content"
        - "The creator revenue problem nobody talks about"
        - "Where AI filmmakers are actually hosting their work (and why it matters)"
        - "The monetization gap for AI-generated content"
        - "Why AI filmmakers need their own platform"
        
        Requirements:
        1. Be bold but not controversial for controversy's sake
        2. Position the problem clearly
        3. Hint at solutions without naming Cinee directly
        4. Spark meaningful discussion
        5. Stay under 280 characters
        
        Output: Draft hot take tweet with reasoning.""",
        expected_output="Draft hot take tweet with supporting reasoning",
        agent=None,
    )


def create_cinee_engagement_task(keywords: List[str] = None) -> Task:
    """Task for engaging with AI filmmakers on Twitter.
    
    Strategy: Find people posting AI films, comment genuinely.
    Don't pitch - just be present. They'll check profile and join waitlist.
    """
    return Task(
        description=f"""Find and engage with AI filmmakers posting their work.
        
        Search for posts with these keywords: {keywords or ['Sora', 'Kling', 'Runway', 'AI film']}
        
        For each creator you find:
        1. Look at their recent AI film content
        2. Draft genuine, appreciative comment about their work
        3. NO pitching Cinee - just be present and authentic
        4. Ask thoughtful questions or share observations
        5. Build genuine connection
        
        Output: List of 5-10 engagement opportunities with suggested replies.""",
        expected_output="List of engagement opportunities with authentic reply suggestions",
        agent=None,
    )


def create_reddit_discussion_task() -> Task:
    """Task for starting discussions on Reddit.
    
    Strategy: Don't promote directly. Start discussions that naturally lead to Cinee.
    """
    return Task(
        description="""Create a discussion post for AI film subreddits.
        
        Target subreddits: r/aivideo, r/sora, r/runwayml, r/StableDiffusion, r/filmmaking
        
        Choose a discussion angle:
        - "Where are you guys actually hosting your AI films?"
        - "How are AI filmmakers monetizing their work?"
        - "What's the biggest challenge for AI content creators right now?"
        - "YouTube vs dedicated platforms for AI films - thoughts?"
        
        Requirements:
        1. Genuine question, not disguised promotion
        2. Let conversation develop naturally
        3. Can mention Cinee only if someone asks about alternatives
        4. Be helpful and present in the discussion
        
        Output: Draft Reddit post with title and body.""",
        expected_output="Draft Reddit discussion post with title and body",
        agent=None,
    )


def create_reddit_engagement_task() -> Task:
    """Task for engaging in Reddit discussions.
    
    Strategy: Find relevant posts, participate authentically.
    """
    return Task(
        description="""Find and engage in relevant Reddit discussions.
        
        Look for posts asking about:
        - Where to host AI films
        - Monetization questions
        - Platform comparisons
        - Creator challenges
        
        For each opportunity:
        1. Read the full post and comments
        2. Draft helpful, authentic reply
        3. Only mention Cinee if it naturally fits the conversation
        4. Focus on being helpful, not promotional
        
        Output: List of engagement opportunities with suggested replies.""",
        expected_output="List of Reddit engagement opportunities with suggested replies",
        agent=None,
    )


def create_daily_content_mix_task() -> Task:
    """Task for planning daily content mix for Twitter.
    
    Strategy: Mix of curation, hot takes, and engagement.
    """
    return Task(
        description="""Plan today's Twitter content mix for Cinee.
        
        Create a balanced schedule with:
        1. AI Film Curation (2-3 posts): Amplify great work from creators
        2. Hot Take (1 post): Industry insight or problem discussion
        3. Engagement Replies (5-10): Genuine comments on AI filmmaker posts
        
        For each item:
        - Specify the type and timing
        - Provide draft content or search criteria
        - Note which creators/topics to focus on
        
        Output: Content calendar for the day with specific posts and timing.""",
        expected_output="Daily content calendar with post types, drafts, and timing",
        agent=None,
    )


def create_creator_outreach_task() -> Task:
    """Task for identifying creators to build relationships with."""
    return Task(
        description="""Identify AI filmmakers to build ongoing relationships with.
        
        Search for creators who:
        - Regularly post AI films (Sora, Kling, Runway)
        - Have engaged audiences
        - Are active in the community
        - Could benefit from Cinee's platform
        
        For each creator:
        1. Profile their content style and audience
        2. Note their current hosting/monetization approach
        3. Suggest authentic engagement approach
        4. Plan ongoing relationship building
        
        Output: List of 10 creators with engagement strategies.""",
        expected_output="List of target creators with engagement strategies",
        agent=None,
    )


def create_waitlist_cta_task(context: str) -> Task:
    """Task for crafting subtle waitlist CTAs.
    
    Strategy: Only use when context naturally allows - never pushy.
    """
    return Task(
        description=f"""Craft a subtle Cinee waitlist mention.
        
        Context: {context}
        
        Requirements:
        1. Only mention if it genuinely helps the conversation
        2. Focus on the problem Cinee solves, not features
        3. Keep it brief and natural
        4. Link: cinee.com (in bio, or naturally in reply)
        
        Output: Draft response with subtle CTA.""",
        expected_output="Draft response with subtle waitlist CTA",
        agent=None,
    )
