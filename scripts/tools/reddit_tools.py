"""Reddit tools - wrappers for Node.js Reddit API endpoints using CrewAI tool format."""
from typing import Any, Dict, List, Optional
from crewai.tools import tool
from .http_client import call_nodejs_tool


@tool("Get Reddit posts")
def get_reddit_posts(subreddit: str, limit: int = 10, sort_by: str = "hot") -> str:
    """Get posts from a subreddit. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/reddit/posts", data={
        "subreddit": subreddit,
        "limit": limit,
        "sort_by": sort_by,
    })
    return str(result)


@tool("Search Reddit posts")
def search_reddit_posts(query: str, subreddit: Optional[str] = None, limit: int = 10) -> str:
    """Search Reddit posts. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/reddit/search", data={
        "query": query,
        "subreddit": subreddit,
        "limit": limit,
    })
    return str(result)


@tool("Create Reddit post")
def create_reddit_post(subreddit: str, title: str, text: str) -> str:
    """Create a Reddit post. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/reddit/create", data={
        "subreddit": subreddit,
        "title": title,
        "text": text,
    })
    return str(result)


@tool("Reply to Reddit post")
def reply_to_reddit_post(post_id: str, text: str) -> str:
    """Reply to a Reddit post. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/reddit/reply", data={
        "post_id": post_id,
        "text": text,
    })
    return str(result)


@tool("Monitor AI film subreddits")
def monitor_ai_film_subreddits() -> str:
    """Monitor AI film related subreddits. Returns JSON result string."""
    result = call_nodejs_tool("/api/tools/reddit/monitor", data={})
    return str(result)


@tool("Find discussion opportunities on Reddit")
def find_discussion_opportunities(subreddits: Optional[List[str]] = None, limit: int = 10) -> str:
    """Find discussion opportunities in AI film subreddits. Returns JSON result string."""
    target_subreddits = subreddits or [
        "aivideo", "sora", "runwayml", "StableDiffusion", "filmmaking"
    ]
    
    opportunities = []
    for subreddit in target_subreddits[:3]:
        posts = get_reddit_posts._run(subreddit, limit=limit // 3)
        if isinstance(posts, list):
            for post in posts:
                if "error" not in post:
                    opportunities.append({
                        "subreddit": subreddit,
                        "post_id": post.get("id"),
                        "title": post.get("title"),
                        "url": post.get("url"),
                    })
    
    result = {
        "success": True,
        "opportunities": opportunities[:limit],
    }
    return str(result)
