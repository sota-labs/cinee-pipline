"""Task definitions for all layers."""

from .brain_tasks import (
    create_strategy_analysis_task,
    create_memory_retrieval_task,
    create_memory_store_task,
    create_strategy_review_task,
)
from .execution_tasks import (
    create_content_planning_task,
    create_daily_briefing_task,
)
from .community_tasks import (
    create_tweet_goal,
    create_reply_goal,
    create_thread_goal,
)
from .cinee_tasks import (
    create_amplification_goal,
    create_hot_take_goal,
    create_engagement_goal,
    create_mentions_goal,
    create_reddit_goal,
    create_daily_content_plan_goal,
)

__all__ = [
    # Brain
    "create_strategy_analysis_task",
    "create_memory_retrieval_task",
    "create_memory_store_task",
    "create_strategy_review_task",
    # Execution
    "create_content_planning_task",
    "create_daily_briefing_task",
    # Community
    "create_tweet_goal",
    "create_reply_goal",
    "create_thread_goal",
    # Cinee
    "create_amplification_goal",
    "create_hot_take_goal",
    "create_engagement_goal",
    "create_mentions_goal",
    "create_reddit_goal",
    "create_daily_content_plan_goal",
]
