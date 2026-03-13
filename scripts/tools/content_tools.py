"""Content tools - wrappers for Node.js content API endpoints."""
from typing import Any, Dict, List, Optional
from .http_client import call_nodejs_tool


def generate_content_ideas(topics: List[str], count: int = 5) -> Dict[str, Any]:
    """Generate content ideas from topics."""
    return call_nodejs_tool("/api/tools/content/ideas", data={
        "topics": topics,
        "count": count,
    })


def calculate_character_count(text: str) -> Dict[str, Any]:
    """Calculate character count for tweet."""
    return call_nodejs_tool("/api/tools/content/char-count", data={"text": text})


def format_tweet(content: str, hashtags: Optional[List[str]] = None, mention: Optional[str] = None) -> Dict[str, Any]:
    """Format tweet with hashtags and mentions."""
    return call_nodejs_tool("/api/tools/content/format", data={
        "content": content,
        "hashtags": hashtags,
        "mention": mention,
    })


def analyze_sentiment(text: str) -> Dict[str, Any]:
    """Analyze sentiment of text."""
    return call_nodejs_tool("/api/tools/content/sentiment", data={"text": text})


def optimize_posting_time(content_type: str = "post") -> Dict[str, Any]:
    """Get optimal posting time (placeholder - returns suggested times)."""
    # This is a placeholder - in production would analyze engagement data
    return {
        "success": True,
        "suggested_times": {
            "morning": "09:00-10:00",
            "midday": "12:00-13:00", 
            "evening": "18:00-19:00",
        },
        "best_time": "09:30",
        "timezone": "UTC",
    }


def suggest_hashtags(topic: str, count: int = 3) -> Dict[str, Any]:
    """Suggest hashtags for a topic."""
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
    
    return {
        "success": True,
        "hashtags": hashtags[:count],
    }


def get_trending_topics(woeid: int = 1) -> List[Dict[str, Any]]:
    """Get trending topics (placeholder - Twitter API v2 requires elevated access)."""
    # Twitter API v2 doesn't have trends endpoint for free tier
    return [{"error": "Trends API requires elevated Twitter access"}]
