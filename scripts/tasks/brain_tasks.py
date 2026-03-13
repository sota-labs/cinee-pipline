"""Brain Layer Tasks."""
from crewai import Task
from typing import List, Dict, Any


def create_strategy_analysis_task(context: List[Dict] = None) -> Task:
    """Task for analyzing and developing content strategy."""
    return Task(
        description="""Analyze the current social media landscape and develop 
        a content strategy for the next planning period. Consider:
        1. Current trends in the industry
        2. Audience engagement patterns
        3. Content performance history
        4. Strategic goals and messaging priorities
        
        Output a strategic brief with recommended themes, topics, and 
        communication priorities.""",
        expected_output="A strategic content brief with themes, topics, and priorities",
        agent=None,  # Will be assigned when creating crew
        context=context or [],
    )


def create_memory_retrieval_task(query: str) -> Task:
    """Task for retrieving relevant memories."""
    return Task(
        description=f"""Search and retrieve relevant past interactions, 
        content, and engagement data related to: {query}
        
        Provide context that will help inform current decision-making and 
        maintain consistency with past communications.""",
        expected_output="Relevant historical context and patterns",
        agent=None,
    )


def create_memory_store_task(content_type: str, content: str, metadata: Dict = None) -> Task:
    """Task for storing new memories."""
    return Task(
        description=f"""Store the following {content_type} in memory for 
        future reference: {content}
        
        Include relevant metadata: {metadata or {}}
        Ensure the memory is indexed for easy retrieval.""",
        expected_output="Confirmation of memory storage",
        agent=None,
    )


def create_strategy_review_task(content: str) -> Task:
    """Task for reviewing content against strategy."""
    return Task(
        description=f"""Review the following content against the established 
        strategy and persona:
        
        {content}
        
        Ensure it aligns with:
        - Brand voice and tone
        - Strategic messaging priorities
        - Audience expectations
        - Professional standards
        
        Provide approval or recommendations for improvement.""",
        expected_output="Strategy alignment review with approval or recommendations",
        agent=None,
    )
