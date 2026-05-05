"""LLM provider abstraction.

Two providers supported:
- "anthropic": Claude via official SDK (production-grade tool use)
- "ollama":    Local models via Ollama's OpenAI-compatible endpoint

Both expose the same interface (`LLMClient.call(...)`) so the agent loop in
`agents/base.py` doesn't care which is in use. The provider is selected via
`settings.llm_provider`.

Internal message/response shape mirrors Anthropic's (content blocks: text /
tool_use, tool_result via `user` role) because the agent loop was already
written against that shape. The Ollama client converts to/from OpenAI format
under the hood.
"""
from __future__ import annotations
from .types import LLMClient, LLMResponse, TextBlock, ToolUseBlock, StopReason

__all__ = ["LLMClient", "LLMResponse", "TextBlock", "ToolUseBlock", "StopReason", "make_llm_client"]


def make_llm_client(provider: str | None = None) -> LLMClient:
    """Factory that returns the configured LLM client.

    If `provider` is None, reads from settings. Defaults to anthropic.
    """
    from ..settings import settings
    p = (provider or settings.llm_provider or "anthropic").lower()

    if p == "anthropic":
        from .anthropic_client import AnthropicClient
        return AnthropicClient(api_key=settings.anthropic_api_key)
    if p == "ollama":
        from .ollama_client import OllamaClient
        return OllamaClient(base_url=settings.ollama_base_url)
    raise ValueError(f"Unknown LLM provider: {p!r}. Use 'anthropic' or 'ollama'.")
