"""Anthropic Claude provider — wraps the official SDK in the LLMClient protocol."""
from __future__ import annotations
from typing import Any

from anthropic import Anthropic
from anthropic.types import TextBlock as AnthropicText, ToolUseBlock as AnthropicToolUse

from .types import LLMResponse, TextBlock, ToolUseBlock, StopReason


class AnthropicClient:
    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY is required for Anthropic provider")
        self._client = Anthropic(api_key=api_key)

    async def call(
        self,
        *,
        model: str,
        system: str,
        messages: list[dict],
        tools: list[dict],
        max_tokens: int = 8192,
        temperature: float = 0.2,
    ) -> LLMResponse:
        # Anthropic SDK is sync; wrap in thread for async call sites.
        import asyncio

        def _do_call():
            return self._client.messages.create(
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                system=system,
                tools=tools,
                messages=messages,
            )

        resp = await asyncio.to_thread(_do_call)

        # Convert Anthropic blocks → normalized blocks
        content: list[Any] = []
        for block in resp.content:
            if isinstance(block, AnthropicText) or getattr(block, "type", None) == "text":
                content.append(TextBlock(text=block.text))
            elif isinstance(block, AnthropicToolUse) or getattr(block, "type", None) == "tool_use":
                content.append(ToolUseBlock(id=block.id, name=block.name, input=dict(block.input)))

        stop: StopReason
        sr = resp.stop_reason
        if sr == "end_turn":
            stop = "end_turn"
        elif sr == "tool_use":
            stop = "tool_use"
        elif sr == "max_tokens":
            stop = "max_tokens"
        else:
            stop = "other"

        return LLMResponse(
            content=content,
            stop_reason=stop,
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
            raw=resp,
        )
