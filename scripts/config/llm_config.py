"""LLM configuration for CrewAI agents."""
from crewai import LLM
from config.settings import settings


def get_brain_llm() -> LLM:
    """Get LLM for Brain layer (Gemini 2.0 Flash)."""
    return LLM(
        model=f"gemini/gemini-2.0-flash",
        api_key=settings.google_api_key,
        temperature=0.7,
        max_tokens=4096
    )


def get_execution_llm() -> LLM:
    """Get LLM for Execution layer (Gemini)."""
    return LLM(
        model=f"gemini/gemini-2.0-flash",
        api_key=settings.google_api_key,
        temperature=0.8,
        max_tokens=2048
    )


def get_community_llm() -> LLM:
    """Get LLM for Community layer (Llama)."""
    return LLM(
        model=f"openai/{settings.llm.community_model}",
        api_key=settings.openai_api_key,
        base_url="https://api.llama-api.com/v1",  # Or local Llama server
        temperature=0.9,
        max_tokens=1024
    )
