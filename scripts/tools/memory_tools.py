"""Memory tools - wrappers for Node.js memory API endpoints."""
from typing import Any, Dict, Optional
from .http_client import call_nodejs_tool


def store_memory(key: str, content: str, metadata: Optional[Dict] = None, ttl: Optional[int] = None) -> Dict[str, Any]:
    """Store content in Redis memory."""
    return call_nodejs_tool("/api/tools/memory/store", data={
        "key": key,
        "content": content,
        "metadata": metadata,
        "ttl": ttl,
    })


def retrieve_memory(key: str) -> Dict[str, Any]:
    """Retrieve content from Redis memory."""
    return call_nodejs_tool("/api/tools/memory/retrieve", method="GET", params={"key": key})


def search_memories(query: str, limit: int = 10) -> Dict[str, Any]:
    """Search memories by query."""
    return call_nodejs_tool("/api/tools/memory/search", data={
        "query": query,
        "limit": limit,
    })


def store_content_history(content_type: str, content: str, tweet_id: Optional[str] = None, metrics: Optional[Dict] = None) -> Dict[str, Any]:
    """Store content in history."""
    return call_nodejs_tool("/api/tools/memory/history", data={
        "content_type": content_type,
        "content": content,
        "tweet_id": tweet_id,
        "metrics": metrics,
    })


def get_recent_history(count: int = 10) -> Dict[str, Any]:
    """Get recent content history."""
    return call_nodejs_tool("/api/tools/memory/recent-history", method="GET", params={"count": count})


def store_engagement_pattern(pattern_type: str, data: Optional[Dict] = None) -> Dict[str, Any]:
    """Store engagement pattern."""
    return call_nodejs_tool("/api/tools/memory/engagement-pattern", data={
        "pattern_type": pattern_type,
        "data": data,
    })


def get_engagement_patterns(pattern_type: Optional[str] = None) -> Dict[str, Any]:
    """Get engagement patterns."""
    return call_nodejs_tool("/api/tools/memory/engagement-patterns", method="GET", params={
        "pattern_type": pattern_type,
    } if pattern_type else {})
