"""Python tools — OpenClaw browser automation + Node.js memory/DB utilities."""

# Browser automation (Twitter & Reddit via OpenClaw)
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

# Database — MongoDB via Node.js REST endpoints
from .db_tools import (
    # Posts
    create_draft_post,
    get_recent_posts,
    update_post,
    is_duplicate_content,
    # Interactions
    save_interaction,
    get_pending_interactions,
    mark_interaction_processed,
    # Replies
    save_reply,
    get_replies_for_interaction,
    # Curation sources
    save_curation_source,
    get_unused_curation_sources,
    mark_curation_used,
    # Persona knowledge
    get_persona_knowledge,
    upsert_persona_knowledge,
    # Stats
    get_daily_stats,
)

__all__ = [
    # Browser
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
    # DB — Posts
    "create_draft_post",
    "get_recent_posts",
    "update_post",
    "is_duplicate_content",
    # DB — Interactions
    "save_interaction",
    "get_pending_interactions",
    "mark_interaction_processed",
    # DB — Replies
    "save_reply",
    "get_replies_for_interaction",
    # DB — Curation
    "save_curation_source",
    "get_unused_curation_sources",
    "mark_curation_used",
    # DB — Persona
    "get_persona_knowledge",
    "upsert_persona_knowledge",
    # DB — Stats
    "get_daily_stats",
]
