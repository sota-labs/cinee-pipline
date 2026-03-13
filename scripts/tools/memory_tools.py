"""Memory tools - wrappers for Node.js memory API endpoints using CrewAI tool format."""
from typing import Any, Dict, Optional
from crewai.tools import tool
from .http_client import call_nodejs_tool


@tool("Store memory in Redis")
def store_memory(key: str, content: str, metadata: Optional[Dict] = None, ttl: Optional[int] = None) -> str:
    """Store content in Redis memory. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/memory/store", data={
        "key": key,
        "content": content,
        "metadata": metadata,
        "ttl": ttl,
    })
    return str(result)


@tool("Retrieve memory from Redis")
def retrieve_memory(key: str) -> str:
    """Retrieve content from Redis memory by key. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/memory/retrieve", method="GET", params={"key": key})
    return str(result)


@tool("Search memories")
def search_memories(query: str, limit: int = 10) -> str:
    """Search memories by query. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/memory/search", data={
        "query": query,
        "limit": limit,
    })
    return str(result)


@tool("Store content history")
def store_content_history(content_type: str, content: str, tweet_id: Optional[str] = None, metrics: Optional[Dict] = None) -> str:
    """Store content in history. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/memory/history", data={
        "content_type": content_type,
        "content": content,
        "tweet_id": tweet_id,
        "metrics": metrics,
    })
    return str(result)


@tool("Get recent history")
def get_recent_history(count: int = 10) -> str:
    """Get recent content history. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/memory/recent-history", method="GET", params={"count": count})
    return str(result)


@tool("Store engagement pattern")
def store_engagement_pattern(pattern_type: str, data: Optional[Dict] = None) -> str:
    """Store engagement pattern. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/memory/engagement-pattern", data={
        "pattern_type": pattern_type,
        "data": data,
    })
    return str(result)


@tool("Get engagement patterns")
def get_engagement_patterns(pattern_type: Optional[str] = None) -> str:
    """Get engagement patterns. Returns JSON result string."""
    params = {"pattern_type": pattern_type} if pattern_type else {}
    result = call_nodejs_tool("/api/tools/memory/engagement-patterns", method="GET", params=params)
    return str(result)
