"""Database tools - wrappers for Node.js SQLite API endpoints using CrewAI tool format."""
from typing import Any, Dict, List, Optional
from crewai.tools import tool
from .http_client import call_nodejs_tool


@tool("Get daily stats")
def get_daily_stats() -> str:
    """Get daily statistics from database. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/db/stats", method="GET")
    return str(result)


@tool("Get recent posts")
def get_recent_posts(limit: int = 20, content_type: Optional[str] = None) -> str:
    """Get recent posts from database. Returns JSON result string."""
    params = {"limit": limit}
    if content_type:
        params["content_type"] = content_type
    result = call_nodejs_tool("/api/tools/db/recent-posts", method="GET", params=params)
    return str(result)


@tool("Save post to database")
def save_post(tweet_id: str, content: str, content_type: str, platform: str = "twitter", strategy_context: Optional[str] = None) -> str:
    """Save a post to database. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/db/save-post", data={
        "tweet_id": tweet_id,
        "content": content,
        "content_type": content_type,
        "platform": platform,
        "strategy_context": strategy_context,
    })
    return str(result)


@tool("Check duplicate content")
def is_duplicate_content(content: str, hours: int = 48) -> str:
    """Check if content is duplicate within specified hours. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/db/duplicate-check", method="GET", params={
        "content": content,
        "hours": hours,
    })
    return str(result)
