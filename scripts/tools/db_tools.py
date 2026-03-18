"""Database tools — CrewAI wrappers for MongoDB collections.

Collections: Posts, Replies, CurationSources, PersonaKnowledge
"""
from typing import Any, Dict, List, Optional
from crewai.tools import tool
from .http_client import call_nodejs_tool


# ── Posts ─────────────────────────────────────────────────────────────────────

@tool("Create draft post")
def create_draft_post(
    raw_content: str,
    content_type: str = "engagement",
    platform: str = "twitter",
    ai_stack: Optional[List[str]] = None,
    media: Optional[List[Dict]] = None,
    external_refs: Optional[List[str]] = None,
    is_viral_candidate: bool = False,
    scheduled_at: Optional[str] = None,
    strategy_context: Optional[str] = None,
) -> str:
    """Save a drafted post to the database (status=draft). Returns JSON with _id."""
    data: Dict[str, Any] = {
        "raw_content": raw_content,
        "content_type": content_type,
        "platform": platform,
        "status": "draft",
        "ai_stack": ai_stack or [],
        "media": media or [],
        "external_refs": external_refs or [],
        "is_viral_candidate": is_viral_candidate,
    }
    if scheduled_at:
        data["scheduled_at"] = scheduled_at
    if strategy_context:
        data["strategy_context"] = strategy_context
    return str(call_nodejs_tool("/api/tools/db/posts", data=data))


@tool("Get recent posts")
def get_recent_posts(
    status: Optional[str] = None,
    content_type: Optional[str] = None,
    platform: Optional[str] = None,
    limit: int = 20,
) -> str:
    """List recent posts. Filter by status/content_type/platform. Returns JSON array."""
    params: Dict[str, Any] = {"limit": limit}
    if status:
        params["status"] = status
    if content_type:
        params["content_type"] = content_type
    if platform:
        params["platform"] = platform
    return str(call_nodejs_tool("/api/tools/db/posts", method="GET", params=params))


@tool("Update post after publishing")
def update_post(
    post_id: str,
    platform_id: Optional[str] = None,
    status: Optional[str] = None,
    metadata: Optional[Dict] = None,
) -> str:
    """Update a post after publishing (set platform_id, status, engagement metadata)."""
    data: Dict[str, Any] = {}
    if platform_id:
        data["platform_id"] = platform_id
    if status:
        data["status"] = status
    if metadata:
        data["metadata"] = metadata
    return str(call_nodejs_tool(f"/api/tools/db/posts/{post_id}", method="PATCH", data=data))


@tool("Check duplicate content")
def is_duplicate_content(content: str, hours: int = 48) -> str:
    """Check if the same content was posted recently. Returns JSON {is_duplicate: bool}."""
    return str(call_nodejs_tool(
        "/api/tools/db/posts/duplicate-check",
        method="GET",
        params={"content": content, "hours": hours},
    ))


# ── Replies ───────────────────────────────────────────────────────────────────

@tool("Save reply")
def save_reply(
    reply_content: str,
    platform: str = "x",
    tone_used: str = "supportive",
    status: str = "resolved",
    thread_id: Optional[str] = None,
    url: Optional[str] = None,
) -> str:
    """Save the CEO's reply. Default status is 'resolved'.
    
    status options: draft | rejected | resolved | replied
    platform options: x | reddit
    tone_used options: supportive | visionary | challenging | curious | grateful
    """
    data: Dict[str, Any] = {
        "reply_content": reply_content,
        "platform": platform,
        "tone_used": tone_used,
        "status": status,
    }
    if thread_id:
        data["thread_id"] = thread_id
    if url:
        data["url"] = url
    return str(call_nodejs_tool("/api/tools/db/replies", data=data))


@tool("Get replies")
def get_replies(
    status: Optional[str] = None,
    platform: Optional[str] = None,
    limit: int = 20,
) -> str:
    """List replies. Filter by status (draft/resolved/replied/rejected) and platform."""
    params: Dict[str, Any] = {"limit": limit}
    if status:
        params["status"] = status
    if platform:
        params["platform"] = platform
    return str(call_nodejs_tool("/api/tools/db/replies", method="GET", params=params))


@tool("Update reply status")
def update_reply(
    reply_id: str,
    status: Optional[str] = None,
    url: Optional[str] = None,
) -> str:
    """Update a reply — e.g. change status from draft to replied after posting."""
    data: Dict[str, Any] = {}
    if status:
        data["status"] = status
    if url:
        data["url"] = url
    return str(call_nodejs_tool(f"/api/tools/db/replies/{reply_id}", method="PATCH", data=data))


@tool("Delete reply")
def delete_reply(reply_id: str) -> str:
    """Delete a reply (e.g. after rejection)."""
    return str(call_nodejs_tool(f"/api/tools/db/replies/{reply_id}", method="DELETE", data={}))


# ── Curation Sources ──────────────────────────────────────────────────────────

@tool("Save curation source")
def save_curation_source(
    source_url: str,
    creator_name: str,
    key_takeaway: str,
    platform: str = "twitter",
    creator_handle: Optional[str] = None,
    ai_stack: Optional[List[str]] = None,
    engagement_score: int = 0,
    video_details: Optional[Dict] = None,
) -> str:
    """Save an AI film discovered by OpenClaw for future amplification. Idempotent by URL."""
    data: Dict[str, Any] = {
        "source_url": source_url,
        "creator_name": creator_name,
        "key_takeaway": key_takeaway,
        "platform": platform,
        "ai_stack": ai_stack or [],
        "engagement_score": engagement_score,
        "used": False,
    }
    if creator_handle:
        data["creator_handle"] = creator_handle
    if video_details:
        data["video_details"] = video_details
    return str(call_nodejs_tool("/api/tools/db/curation", data=data))


@tool("Get unused curation sources")
def get_unused_curation_sources(limit: int = 5) -> str:
    """Get AI films ready to be amplified (sorted by engagement score)."""
    return str(call_nodejs_tool(
        "/api/tools/db/curation", method="GET", params={"used": "false", "limit": limit}
    ))


@tool("Mark curation source as used")
def mark_curation_used(source_id: str) -> str:
    """Mark an AI film as already amplified to avoid duplicates."""
    return str(call_nodejs_tool(
        f"/api/tools/db/curation/{source_id}/used", method="PATCH", data={}
    ))


# ── Persona Knowledge ─────────────────────────────────────────────────────────

@tool("Get persona knowledge")
def get_persona_knowledge(topic: Optional[str] = None) -> str:
    """Get the CEO's stances and opinions. Pass topic to filter. Used before writing."""
    params = {"topic": topic} if topic else {}
    return str(call_nodejs_tool("/api/tools/db/persona", method="GET", params=params))


@tool("Upsert persona knowledge")
def upsert_persona_knowledge(topic: str, stance: str, keywords: Optional[List[str]] = None) -> str:
    """Add or update the CEO's stance on a topic."""
    return str(call_nodejs_tool("/api/tools/db/persona", data={
        "topic": topic,
        "stance": stance,
        "keywords": keywords or [],
    }))


# ── Stats ─────────────────────────────────────────────────────────────────────

@tool("Get daily stats")
def get_daily_stats() -> str:
    """Get today's pipeline statistics from MongoDB."""
    return str(call_nodejs_tool("/api/tools/db/stats", method="GET"))
