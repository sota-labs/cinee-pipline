"""Content tools - wrappers for Node.js content API endpoints using CrewAI tool format."""
from typing import Any, Dict, List, Optional
from crewai.tools import tool
from .http_client import call_nodejs_tool


@tool("Generate content ideas")
def generate_content_ideas(topics: List[str], count: int = 5) -> str:
    """Generate content ideas from topics. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/content/ideas", data={
        "topics": topics,
        "count": count,
    })
    return str(result)


@tool("Calculate character count")
def calculate_character_count(text: str) -> str:
    """Calculate character count for tweet. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/content/char-count", data={"text": text})
    return str(result)


@tool("Format tweet")
def format_tweet(content: str, hashtags: Optional[List[str]] = None, mention: Optional[str] = None) -> str:
    """Format tweet with hashtags and mentions. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/content/format", data={
        "content": content,
        "hashtags": hashtags,
        "mention": mention,
    })
    return str(result)


@tool("Analyze sentiment")
def analyze_sentiment(text: str) -> str:
    """Analyze sentiment of text. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/content/sentiment", data={"text": text})
    return str(result)


@tool("Optimize posting time")
def optimize_posting_time(content_type: str = "post") -> str:
    """Get optimal posting time. Returns JSON result string."""
    # This is a placeholder - in production would analyze engagement data
    result = {
        "success": True,
        "suggested_times": {
            "morning": "09:00-10:00",
            "midday": "12:00-13:00", 
            "evening": "18:00-19:00",
        },
        "best_time": "09:30",
        "timezone": "UTC",
    }
    return str(result)


@tool("Suggest hashtags")
def suggest_hashtags(topic: str, count: int = 3) -> str:
    """Suggest hashtags for a topic. Returns JSON result string."""
    # Generate relevant hashtags based on topic
    base_hashtags = {
        "AI film": ["#AIvideo", "#AIfilmmaking", "#generativeAI"],
        "Sora": ["#Sora", "#OpenAI", "#AIvideo"],
        "Runway": ["#RunwayML", "#Gen2", "#AIvideo"],
        "Kling": ["#Kling", "#AIvideo", "#AIfilmmaking"],
        "Cinee": ["#Cinee", "#AIfilmmaker", "#AIvideo"],
    }
    
    hashtags = []
    for key, tags in base_hashtags.items():
        if key.lower() in topic.lower():
            hashtags.extend(tags[:count])
    
    if not hashtags:
        hashtags = ["#AIvideo", "#AIfilmmaking", "#generativeAI"]
    
    result = {
        "success": True,
        "hashtags": hashtags[:count],
    }
    return str(result)
