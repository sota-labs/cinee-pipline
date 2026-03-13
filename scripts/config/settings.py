"""Configuration settings for the pipeline."""
import os
from dotenv import load_dotenv
from pydantic import BaseModel
from typing import Optional

load_dotenv()


class LLMConfig(BaseModel):
    """LLM configuration for each layer."""
    brain_model: str = "claude-3-opus-20240229"
    execution_model: str = "gemini-2.5-pro"
    community_model: str = "llama-3.1-70b-instruct"


class RoleConfig(BaseModel):
    """Role/persona configuration — CEO/Founder of Cinee.com doing founder-led content."""
    name: str = "CEO of Cinee"
    brand: str = "Cinee"
    founder_name: str = os.getenv("FOUNDER_NAME", "Founder")
    website: str = "cinee.com"
    company_stage: str = "building"  # building / launched / scaling
    persona: str = """You are the CEO and founder of Cinee.com — a platform built specifically 
    for AI filmmakers to host, share, and monetize their work. You're a builder who lives and 
    breathes this space. You personally use Sora, Kling, Runway, and understand the pain points 
    because you've experienced them yourself.

    Your content style is founder-led: you share your journey building Cinee, your vision for 
    the future of AI filmmaking, and genuine appreciation for creators in the community. You 
    speak from personal experience — making product decisions, talking to creators, seeing the 
    problems firsthand.

    You are NOT a brand account. You are a person who happens to be building something for 
    this community. Your posts feel like a friend who's deeply passionate about AI films, not 
    a corporate marketing team. You celebrate others' work before talking about your own.

    Rules:
    - Never pitch Cinee directly. Let curiosity lead people to check your profile/bio.
    - Share genuine reactions to AI films you discover.
    - Talk about industry problems from a founder's perspective.
    - Be vulnerable about the startup journey when appropriate.
    - Engage in conversations as a peer, not as a brand."""
    tone: str = "personal, visionary, authentic, builder-mindset, conversational"
    topics: list[str] = [
        "building Cinee", "AI filmmaking future", "creator economy",
        "startup journey", "Sora", "Kling", "Runway", "AI video generation",
        "creator monetization", "platform building", "founder life",
        "AI film hosting", "YouTube algorithm challenges", "Stable Diffusion video"
    ]
    # Personal topics the CEO shares about
    personal_topics: list[str] = [
        "lessons from building a startup",
        "conversations with AI filmmakers",
        "product decisions and why we made them",
        "the future I see for AI cinema",
        "what I learned this week"
    ]
    # Target communities
    communities: list[str] = [
        "r/aivideo", "r/sora", "r/runwayml", "r/StableDiffusion", "r/filmmaking"
    ]
    # Keywords to monitor for engagement
    engagement_keywords: list[str] = [
        "Sora", "Kling", "Runway", "AI film", "AI video", "generative video",
        "AI filmmaker", "AI content creator"
    ]


class TwitterConfig(BaseModel):
    """Twitter API configuration."""
    api_key: str = os.getenv("TWITTER_API_KEY", "")
    api_secret: str = os.getenv("TWITTER_API_SECRET", "")
    access_token: str = os.getenv("TWITTER_ACCESS_TOKEN", "")
    access_secret: str = os.getenv("TWITTER_ACCESS_SECRET", "")
    bearer_token: str = os.getenv("TWITTER_BEARER_TOKEN", "")


class RedditConfig(BaseModel):
    """Reddit API configuration."""
    client_id: str = os.getenv("REDDIT_CLIENT_ID", "")
    client_secret: str = os.getenv("REDDIT_CLIENT_SECRET", "")
    username: str = os.getenv("REDDIT_USERNAME", "")
    password: str = os.getenv("REDDIT_PASSWORD", "")


class Settings(BaseModel):
    """Main settings."""
    llm: LLMConfig = LLMConfig()
    role: RoleConfig = RoleConfig()
    twitter: TwitterConfig = TwitterConfig()
    reddit: RedditConfig = RedditConfig()
    redis_url: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    sqlite_db_path: str = os.getenv("SQLITE_DB_PATH", "pipeline.db")
    
    # API Keys
    anthropic_api_key: Optional[str] = os.getenv("ANTHROPIC_API_KEY")
    google_api_key: Optional[str] = os.getenv("GOOGLE_API_KEY")
    openai_api_key: Optional[str] = os.getenv("OPENAI_API_KEY")
    
    # Reddit config shortcuts for tools
    reddit_client_id: Optional[str] = os.getenv("REDDIT_CLIENT_ID")
    reddit_client_secret: Optional[str] = os.getenv("REDDIT_CLIENT_SECRET")
    reddit_username: Optional[str] = os.getenv("REDDIT_USERNAME")
    reddit_password: Optional[str] = os.getenv("REDDIT_PASSWORD")


settings = Settings()
