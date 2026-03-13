"""Python tools that call back to Node.js API endpoints."""
from .memory_tools import (
    store_memory,
    retrieve_memory,
    search_memories,
    store_content_history,
    get_recent_history,
    store_engagement_pattern,
    get_engagement_patterns,
)
from .twitter_tools import (
    post_tweet,
    reply_to_tweet,
    get_mentions,
    like_tweet,
    retweet_tweet,
    retweet,  # Alias for backward compatibility
    search_tweets,
    quote_tweet,
    get_tweet_details,
    get_trending_topics,
)
from .reddit_tools import (
    get_reddit_posts,
    search_reddit_posts,
    create_reddit_post,
    reply_to_reddit_post,
    monitor_ai_film_subreddits,
    find_discussion_opportunities,
)
from .content_tools import (
    generate_content_ideas,
    calculate_character_count,
    format_tweet,
    analyze_sentiment,
    optimize_posting_time,
    suggest_hashtags,
)
from .cinee_tools import (
    find_ai_films_to_amplify,
    draft_amplification_comment,
    find_creator_engagement_opportunities,
    generate_hot_take_topics,
    get_daily_engagement_targets,
)
from .db_tools import (
    get_daily_stats,
    get_recent_posts,
    save_post,
    is_duplicate_content,
)

__all__ = [
    # Memory
    "store_memory",
    "retrieve_memory", 
    "search_memories",
    "store_content_history",
    "get_recent_history",
    "store_engagement_pattern",
    "get_engagement_patterns",
    # Twitter
    "post_tweet",
    "reply_to_tweet",
    "get_mentions",
    "like_tweet",
    "retweet_tweet",
    "retweet",
    "search_tweets",
    "quote_tweet",
    "get_tweet_details",
    "get_trending_topics",
    # Reddit
    "get_reddit_posts",
    "search_reddit_posts",
    "create_reddit_post",
    "reply_to_reddit_post",
    "monitor_ai_film_subreddits",
    "find_discussion_opportunities",
    # Content
    "generate_content_ideas",
    "calculate_character_count",
    "format_tweet",
    "analyze_sentiment",
    "optimize_posting_time",
    "suggest_hashtags",
    # Cinee
    "find_ai_films_to_amplify",
    "draft_amplification_comment",
    "find_creator_engagement_opportunities",
    "generate_hot_take_topics",
    "get_daily_engagement_targets",
    # DB
    "get_daily_stats",
    "get_recent_posts",
    "save_post",
    "is_duplicate_content",
]
