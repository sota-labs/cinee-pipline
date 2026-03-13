"""Database tools - wrappers for Node.js SQLite API endpoints."""
from typing import Any, Dict, List, Optional
from .http_client import call_nodejs_tool


def get_daily_stats() -> Dict[str, Any]:
    """Get daily statistics."""
    return call_nodejs_tool("/api/tools/db/stats", method="GET")


def get_recent_posts(limit: int = 20, content_type: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get recent posts from database."""
    params = {"limit": limit}
    if content_type:
        params["content_type"] = content_type
    return call_nodejs_tool("/api/tools/db/recent-posts", method="GET", params=params)


def save_post(tweet_id: str, content: str, content_type: str, platform: str = "twitter", strategy_context: Optional[str] = None) -> Dict[str, Any]:
    """Save a post to database."""
    return call_nodejs_tool("/api/tools/db/save-post", data={
        "tweet_id": tweet_id,
        "content": content,
        "content_type": content_type,
        "platform": platform,
        "strategy_context": strategy_context,
    })


def is_duplicate_content(content: str, hours: int = 48) -> Dict[str, Any]:
    """Check if content is duplicate within specified hours."""
    return call_nodejs_tool("/api/tools/db/duplicate-check", method="GET", params={
        "content": content,
        "hours": hours,
    })
