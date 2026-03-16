"""Python tools — OpenClaw browser automation + Node.js memory/DB utilities."""

# Browser automation (replaces direct Twitter/Reddit API tools)
from .openclaw_browser import (
    twitter_browser_task,
    reddit_browser_task,
)

# Memory (Redis, via Node.js)
from .memory_tools import (
    store_memory,
    retrieve_memory,
    search_memories,
    store_content_history,
    get_recent_history,
    store_engagement_pattern,
    get_engagement_patterns,
)

# Content utilities (via Node.js)
from .content_tools import (
    generate_content_ideas,
    calculate_character_count,
    format_tweet,
    analyze_sentiment,
    optimize_posting_time,
    suggest_hashtags,
)

# Database (SQLite, via Node.js)
from .db_tools import (
    get_daily_stats,
    get_recent_posts,
    save_post,
    is_duplicate_content,
)

__all__ = [
    # Browser automation
    "twitter_browser_task",
    "reddit_browser_task",
    # Memory
    "store_memory",
    "retrieve_memory",
    "search_memories",
    "store_content_history",
    "get_recent_history",
    "store_engagement_pattern",
    "get_engagement_patterns",
    # Content
    "generate_content_ideas",
    "calculate_character_count",
    "format_tweet",
    "analyze_sentiment",
    "optimize_posting_time",
    "suggest_hashtags",
    # DB
    "get_daily_stats",
    "get_recent_posts",
    "save_post",
    "is_duplicate_content",
]
