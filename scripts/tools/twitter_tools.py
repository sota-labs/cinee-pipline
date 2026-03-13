"""Twitter tools - wrappers for Node.js Twitter API endpoints using CrewAI tool format."""
from typing import Any, Dict, List, Optional
from crewai.tools import tool
from .http_client import call_nodejs_tool


@tool("Post a tweet")
def post_tweet(text: str, media_ids: Optional[List[str]] = None) -> str:
    """Post a tweet to Twitter. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/twitter/post", data={
        "text": text,
        "media_ids": media_ids,
    })
    return str(result)


@tool("Reply to a tweet")
def reply_to_tweet(text: str, tweet_id: str) -> str:
    """Reply to a tweet on Twitter. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/twitter/reply", data={
        "text": text,
        "tweet_id": tweet_id,
    })
    return str(result)


@tool("Get Twitter mentions")
def get_mentions(max_results: int = 10, since_id: Optional[str] = None) -> str:
    """Get mentions timeline from Twitter. Returns JSON result string."""
    params = {"max_results": max_results}
    if since_id:
        params["since_id"] = since_id
    result = call_nodejs_tool("/api/tools/twitter/mentions", method="GET", params=params)
    return str(result)


@tool("Like a tweet")
def like_tweet(tweet_id: str) -> str:
    """Like a tweet on Twitter. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/twitter/like", data={"tweet_id": tweet_id})
    return str(result)


@tool("Retweet a tweet")
def retweet_tweet(tweet_id: str) -> str:
    """Retweet a tweet on Twitter. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/twitter/retweet", data={"tweet_id": tweet_id})
    return str(result)


# Alias for backward compatibility
retweet = retweet_tweet


@tool("Search tweets")
def search_tweets(query: str, max_results: int = 10) -> str:
    """Search for tweets on Twitter. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/twitter/search", data={
        "query": query,
        "max_results": max_results,
    })
    return str(result)


@tool("Quote tweet")
def quote_tweet(text: str, tweet_id: str) -> str:
    """Quote a tweet on Twitter. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/twitter/quote", data={
        "text": text,
        "tweet_id": tweet_id,
    })
    return str(result)


@tool("Get tweet details")
def get_tweet_details(tweet_id: str) -> str:
    """Get details of a tweet. Returns JSON result string."""
    result = call_nodejs_tool(f"/api/tools/twitter/tweet/{tweet_id}", method="GET")
    return str(result)


@tool("Get trending topics")
def get_trending_topics(woeid: int = 1) -> str:
    """Get trending topics (placeholder - Twitter API v2 requires elevated access). Returns JSON result string."""
    # Twitter API v2 doesn't have trends endpoint for free tier
    return str([{"error": "Trends API requires elevated Twitter access"}])
