"""Reddit tools - wrappers for Node.js Reddit API endpoints."""
from typing import Any, Dict, List, Optional
from .http_client import call_nodejs_tool


def get_reddit_posts(subreddit: str, limit: int = 10, sort_by: str = "hot") -> List[Dict[str, Any]]:
    """Get posts from a subreddit."""
    return call_nodejs_tool("/api/tools/reddit/posts", data={
        "subreddit": subreddit,
        "limit": limit,
        "sort_by": sort_by,
    })


def search_reddit_posts(query: str, subreddit: Optional[str] = None, limit: int = 10) -> List[Dict[str, Any]]:
    """Search Reddit posts."""
    return call_nodejs_tool("/api/tools/reddit/search", data={
        "query": query,
        "subreddit": subreddit,
        "limit": limit,
    })


def create_reddit_post(subreddit: str, title: str, text: str) -> Dict[str, Any]:
    """Create a Reddit post."""
    return call_nodejs_tool("/api/tools/reddit/create", data={
        "subreddit": subreddit,
        "title": title,
        "text": text,
    })


def reply_to_reddit_post(post_id: str, text: str) -> Dict[str, Any]:
    """Reply to a Reddit post."""
    return call_nodejs_tool("/api/tools/reddit/reply", data={
        "post_id": post_id,
        "text": text,
    })


def monitor_ai_film_subreddits() -> Dict[str, Any]:
    """Monitor AI film related subreddits."""
    return call_nodejs_tool("/api/tools/reddit/monitor", data={})


def find_discussion_opportunities(subreddits: Optional[List[str]] = None, limit: int = 10) -> Dict[str, Any]:
    """Find discussion opportunities in AI film subreddits."""
    target_subreddits = subreddits or [
        "aivideo", "sora", "runwayml", "StableDiffusion", "filmmaking"
    ]
    
    opportunities = []
    for subreddit in target_subreddits[:3]:
        posts = get_reddit_posts(subreddit, limit=limit // 3)
        if isinstance(posts, list):
            for post in posts:
                if "error" not in post:
                    opportunities.append({
                        "subreddit": subreddit,
                        "post_id": post.get("id"),
                        "title": post.get("title"),
                        "url": post.get("url"),
                    })
    
    return {
        "success": True,
        "opportunities": opportunities[:limit],
    }
