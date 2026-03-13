"""Cinee-specific tools for AI filmmaker engagement using CrewAI tool format."""
from typing import Any, Dict, List, Optional
from crewai.tools import tool
from .http_client import call_nodejs_tool


@tool("Find AI films to amplify")
def find_ai_films_to_amplify(count: int = 5) -> str:
    """Find AI films to amplify (quote-tweet). Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/cinee/find-films", data={"count": count})
    return str(result)


@tool("Draft amplification comment")
def draft_amplification_comment(film_description: str, creator_handle: str) -> str:
    """Draft an amplification comment for an AI film. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/cinee/draft-comment", data={
        "film_description": film_description,
        "creator_handle": creator_handle,
    })
    return str(result)


@tool("Generate hot take topics")
def generate_hot_take_topics() -> str:
    """Generate hot take topics for CEO. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/cinee/hot-take-topics", data={})
    return str(result)


@tool("Get daily engagement targets")
def get_daily_engagement_targets() -> str:
    """Get daily engagement targets. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/cinee/engagement-targets", method="GET")
    return str(result)


@tool("Find creator engagement opportunities")
def find_creator_engagement_opportunities(keywords: Optional[List[str]] = None, count: int = 10) -> str:
    """Find opportunities to engage with AI creators. Returns JSON result string."""
    from .twitter_tools import search_tweets
    
    search_keywords = keywords or [
        "AI film", "AI video", "Sora", "Kling", "Runway",
        "generative video", "AI filmmaker"
    ]
    
    results = []
    for keyword in search_keywords[:3]:  # Limit searches
        tweets = search_tweets._run(keyword, max_results=count // 3)
        if isinstance(tweets, list) and tweets:
            for tweet in tweets:
                if "error" not in tweet:
                    results.append({
                        "tweet_id": tweet.get("tweet_id"),
                        "text": tweet.get("text"),
                        "keyword": keyword,
                    })
    
    result = {
        "success": True,
        "opportunities": results[:count],
    }
    return str(result)
