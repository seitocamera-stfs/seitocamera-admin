"""Shared types for the LLM provider abstraction.

Mirrors Anthropic's content-block shape (text + tool_use blocks, with
tool_result delivered via user-role messages) because the agent loop was
already written against that shape.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal, Protocol, Any

StopReason = Literal["end_turn", "tool_use", "max_tokens", "other"]


@dataclass
class TextBlock:
    text: str
    type: Literal["text"] = "text"


@dataclass
class ToolUseBlock:
    id: str
    name: str
    input: dict
    type: Literal["tool_use"] = "tool_use"


@dataclass
class LLMResponse:
    """Normalized response from any LLM provider."""
    content: list[Any]  # list of TextBlock | ToolUseBlock
    stop_reason: StopReason
    input_tokens: int
    output_tokens: int
    raw: Any = field(default=None, repr=False)  # provider-specific raw response, for debugging


class LLMClient(Protocol):
    """Async LLM client interface used by the agent loop.

    Messages follow Anthropic's shape:
      [{"role": "user"|"assistant", "content": str | list[block]}, ...]
    where each block is either {"type":"text","text":...},
    {"type":"tool_use", "id":..., "name":..., "input":...}, or
    {"type":"tool_result", "tool_use_id":..., "content":..., "is_error":...}.

    Tools follow Anthropic's tool-definition shape:
      {"name": str, "description": str, "input_schema": JSONSchema}
    """

    async def call(
        self,
        *,
        model: str,
        system: str,
        messages: list[dict],
        tools: list[dict],
        max_tokens: int = 8192,
        temperature: float = 0.2,
    ) -> LLMResponse: ...
