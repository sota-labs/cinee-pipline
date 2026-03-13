"""Cinee-specific tools for AI filmmaker engagement."""
from typing import Any, Dict, List, Optional
from .http_client import call_nodejs_tool


def find_ai_films_to_amplify(count: int = 5) -> Dict[str, Any]:
    """Find AI films to amplify (quote-tweet)."""
    return call_nodejs_tool("/api/tools/cinee/find-films", data={"count": count})


def draft_amplification_comment(film_description: str, creator_handle: str) -> Dict[str, Any]:
    """Draft an amplification comment for an AI film."""
    return call_nodejs_tool("/api/tools/cinee/draft-comment", data={
        "film_description": film_description,
        "creator_handle": creator_handle,
    })


def generate_hot_take_topics() -> Dict[str, Any]:
    """Generate hot take topics for CEO."""
    return call_nodejs_tool("/api/tools/cinee/hot-take-topics", data={})


def get_daily_engagement_targets() -> Dict[str, Any]:
    """Get daily engagement targets."""
    return call_nodejs_tool("/api/tools/cinee/engagement-targets", method="GET")


def find_creator_engagement_opportunities(keywords: Optional[List[str]] = None, count: int = 10) -> Dict[str, Any]:
    """Find opportunities to engage with AI creators."""
    # Use search to find relevant tweets
    from .twitter_tools import search_tweets
    
    search_keywords = keywords or [
        "AI film", "AI video", "Sora", "Kling", "Runway",
        "generative video", "AI filmmaker"
    ]
    
    results = []
    for keyword in search_keywords[:3]:  # Limit searches
        tweets = search_tweets(keyword, max_results=count // 3)
        if isinstance(tweets, list) and tweets:
            for tweet in tweets:
                if "error" not in tweet:
                    results.append({
                        "tweet_id": tweet.get("tweet_id"),
                        "text": tweet.get("text"),
                        "keyword": keyword,
                    })
    
    return {
        "success": True,
        "opportunities": results[:count],
    }
