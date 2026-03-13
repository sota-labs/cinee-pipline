"""Twitter tools - wrappers for Node.js Twitter API endpoints."""
from typing import Any, Dict, List, Optional
from .http_client import call_nodejs_tool


def post_tweet(text: str, media_ids: Optional[List[str]] = None) -> Dict[str, Any]:
    """Post a tweet."""
    return call_nodejs_tool("/api/tools/twitter/post", data={
        "text": text,
        "media_ids": media_ids,
    })


def reply_to_tweet(text: str, tweet_id: str) -> Dict[str, Any]:
    """Reply to a tweet."""
    return call_nodejs_tool("/api/tools/twitter/reply", data={
        "text": text,
        "tweet_id": tweet_id,
    })


def get_mentions(max_results: int = 10, since_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Get mentions timeline."""
    params = {"max_results": max_results}
    if since_id:
        params["since_id"] = since_id
    return call_nodejs_tool("/api/tools/twitter/mentions", method="GET", params=params)


def like_tweet(tweet_id: str) -> Dict[str, Any]:
    """Like a tweet."""
    return call_nodejs_tool("/api/tools/twitter/like", data={"tweet_id": tweet_id})


def retweet_tweet(tweet_id: str) -> Dict[str, Any]:
    """Retweet a tweet."""
    return call_nodejs_tool("/api/tools/twitter/retweet", data={"tweet_id": tweet_id})


def search_tweets(query: str, max_results: int = 10) -> List[Dict[str, Any]]:
    """Search for tweets."""
    return call_nodejs_tool("/api/tools/twitter/search", data={
        "query": query,
        "max_results": max_results,
    })


def quote_tweet(text: str, tweet_id: str) -> Dict[str, Any]:
    """Quote a tweet."""
    return call_nodejs_tool("/api/tools/twitter/quote", data={
        "text": text,
        "tweet_id": tweet_id,
    })


def get_tweet_details(tweet_id: str) -> Dict[str, Any]:
    """Get tweet details."""
    return call_nodejs_tool(f"/api/tools/twitter/tweet/{tweet_id}", method="GET")


# Alias for backward compatibility
retweet = retweet_tweet


def get_trending_topics(woeid: int = 1) -> List[Dict[str, Any]]:
    """Get trending topics (placeholder - Twitter API v2 requires elevated access)."""
    # Twitter API v2 doesn't have trends endpoint for free tier
    return [{"error": "Trends API requires elevated Twitter access"}]
