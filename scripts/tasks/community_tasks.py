"""Community Layer Tasks."""
from crewai import Task
from typing import List, Dict, Any


def create_content_writing_task(topic: str, content_type: str = "post") -> Task:
    """Task for writing content."""
    return Task(
        description=f"""Write a {content_type} about: {topic}
        
        Requirements:
        1. Sound like it was written personally by the role
        2. Be engaging and authentic
        3. Keep within Twitter character limits (280 chars for posts)
        4. Include relevant hashtags if appropriate
        5. Maintain professional yet approachable tone
        
        Output the final content ready for publishing.""",
        expected_output="Final content ready for publishing",
        agent=None,
    )


def create_publishing_task(content: str, scheduled_time: str = None) -> Task:
    """Task for publishing content to Twitter."""
    return Task(
        description=f"""Publish the following content to Twitter:
        
        Content: {content}
        {f'Scheduled time: {scheduled_time}' if scheduled_time else 'Publish immediately'}
        
        Verify:
        1. Character count is within limits
        2. Formatting is correct
        3. Links and media are attached properly
        
        Return the post URL and confirmation.""",
        expected_output="Post URL and publication confirmation",
        agent=None,
    )


def create_reply_drafting_task(comment: str, post_context: str) -> Task:
    """Task for drafting a reply to a comment."""
    return Task(
        description=f"""Draft a reply to this comment:
        
        Comment: {comment}
        Post Context: {post_context}
        
        Requirements:
        1. Be authentic and personal
        2. Address the comment appropriately
        3. Maintain the role's voice
        4. Be concise (Twitter reply limits apply)
        5. Foster positive engagement
        
        Output the reply text ready for publishing.""",
        expected_output="Reply text ready for publishing",
        agent=None,
    )


def create_reply_publishing_task(reply_text: str, tweet_id: str) -> Task:
    """Task for publishing a reply."""
    return Task(
        description=f"""Publish this reply:
        
        Reply: {reply_text}
        To Tweet ID: {tweet_id}
        
        Return the reply URL and confirmation.""",
        expected_output="Reply URL and publication confirmation",
        agent=None,
    )


def create_engagement_task(action: str, target_id: str, context: str = None) -> Task:
    """Task for engagement actions (like, retweet, follow)."""
    return Task(
        description=f"""Perform engagement action: {action}
        Target ID: {target_id}
        {f'Context: {context}' if context else ''}
        
        Return confirmation of action.""",
        expected_output="Confirmation of engagement action",
        agent=None,
    )


def create_bulk_reply_task(comments: List[Dict]) -> Task:
    """Task for handling multiple comments."""
    return Task(
        description=f"""Process and reply to multiple comments:
        
        Comments: {comments}
        
        For each comment:
        1. Assess priority and sentiment
        2. Draft appropriate reply
        3. Prepare for publishing
        
        Output a list of replies with their target tweet IDs.""",
        expected_output="List of replies with target tweet IDs",
        agent=None,
    )
