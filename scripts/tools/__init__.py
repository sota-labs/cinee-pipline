"""Python tools — OpenClaw browser automation + Node.js memory/DB utilities."""

from .openclaw_browser import (
    twitter_browser_task,
    reddit_browser_task,
)

from .memory_tools import (
    store_memory,
    retrieve_memory,
    search_memories,
    store_content_history,
    get_recent_history,
    store_engagement_pattern,
    get_engagement_patterns,
)

from .content_tools import (
    generate_content_ideas,
    calculate_character_count,
    format_tweet,
    analyze_sentiment,
    optimize_posting_time,
    suggest_hashtags,
)

from .db_tools import (
    # Posts
    create_draft_post,
    get_recent_posts,
    update_post,
    is_duplicate_content,
    # Replies
    save_reply,
    get_replies,
    update_reply,
    delete_reply,
    # Curation
    save_curation_source,
    get_unused_curation_sources,
    mark_curation_used,
    # Persona
    get_persona_knowledge,
    upsert_persona_knowledge,
    # Stats
    get_daily_stats,
)

__all__ = [
    "twitter_browser_task",
    "reddit_browser_task",
    "store_memory",
    "retrieve_memory",
    "search_memories",
    "store_content_history",
    "get_recent_history",
    "store_engagement_pattern",
    "get_engagement_patterns",
    "generate_content_ideas",
    "calculate_character_count",
    "format_tweet",
    "analyze_sentiment",
    "optimize_posting_time",
    "suggest_hashtags",
    "create_draft_post",
    "get_recent_posts",
    "update_post",
    "is_duplicate_content",
    "save_reply",
    "get_replies",
    "update_reply",
    "delete_reply",
    "save_curation_source",
    "get_unused_curation_sources",
    "mark_curation_used",
    "get_persona_knowledge",
    "upsert_persona_knowledge",
    "get_daily_stats",
]
