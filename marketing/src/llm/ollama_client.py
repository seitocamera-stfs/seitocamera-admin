"""Ollama provider — uses Ollama's OpenAI-compatible chat-completions endpoint.

Ollama exposes `${base_url}/v1/chat/completions` accepting the OpenAI shape
including `tools` for function calling. We use the OpenAI Python SDK pointed
at this endpoint (no API key required, but the SDK demands a non-empty
string).

Conversion notes:
- Agent loop emits Anthropic-style messages with content blocks. We convert
  them to OpenAI-style: tool_use → assistant message with `tool_calls`,
  tool_result → `tool` role messages.
- OpenAI `tool_calls[].function.arguments` is a JSON STRING (not dict). We
  parse it back when converting to a `ToolUseBlock`.
- Some local models return tool calls inline as plain text (e.g., wrapped in
  `<tool_call>...</tool_call>`). When `tool_calls` is empty but the text
  matches that pattern, we extract them (best-effort fallback for Qwen-style
  models).
"""
from __future__ import annotations
import json
import re
import uuid
from typing import Any

from openai import AsyncOpenAI

from .types import LLMResponse, TextBlock, ToolUseBlock, StopReason

# Best-effort fallback for models that emit tool calls inline as text rather
# than via the structured tool_calls field. Qwen3 in particular sometimes
# does this. Pattern: <tool_call>{"name": "...", "arguments": {...}}</tool_call>
_INLINE_TOOL_CALL_RE = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.DOTALL)


class OllamaClient:
    def __init__(self, base_url: str = "http://localhost:11434") -> None:
        # Ollama OpenAI-compatible endpoint lives at /v1
        self._client = AsyncOpenAI(
            base_url=f"{base_url.rstrip('/')}/v1",
            api_key="ollama",  # SDK requires a non-empty string; Ollama ignores it
        )

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
        oai_messages = [{"role": "system", "content": system}]
        oai_messages.extend(_anthropic_to_openai_messages(messages))
        oai_tools = [_anthropic_to_openai_tool(t) for t in tools]

        resp = await self._client.chat.completions.create(
            model=model,
            messages=oai_messages,
            tools=oai_tools or None,
            tool_choice="auto" if oai_tools else "none",
            temperature=temperature,
            max_tokens=max_tokens,
        )

        choice = resp.choices[0]
        msg = choice.message
        content: list[Any] = []

        # Text content (if any)
        text_content = msg.content or ""
        # Strip <think>...</think> blocks (Qwen3 etc.) so they don't pollute the output.
        text_content = re.sub(r"<think>.*?</think>\s*", "", text_content, flags=re.DOTALL).strip()

        # Structured tool calls (preferred path)
        tool_calls = msg.tool_calls or []
        for tc in tool_calls:
            try:
                args = json.loads(tc.function.arguments) if isinstance(tc.function.arguments, str) else (tc.function.arguments or {})
            except json.JSONDecodeError:
                args = {"_raw_arguments": tc.function.arguments}
            content.append(ToolUseBlock(id=tc.id or _gen_id(), name=tc.function.name, input=args))

        # Fallback: detect inline <tool_call>...</tool_call>
        if not tool_calls and text_content:
            inline = _INLINE_TOOL_CALL_RE.findall(text_content)
            if inline:
                for raw in inline:
                    try:
                        obj = json.loads(raw)
                        name = obj.get("name") or obj.get("tool")
                        args = obj.get("arguments") or obj.get("input") or {}
                        if name:
                            content.append(ToolUseBlock(id=_gen_id(), name=name, input=args))
                    except json.JSONDecodeError:
                        continue
                # Strip the inline tool_call markers from the text
                text_content = _INLINE_TOOL_CALL_RE.sub("", text_content).strip()

        if text_content:
            # Put text BEFORE tool_use blocks (matches Anthropic order)
            content.insert(0, TextBlock(text=text_content))

        # Determine stop_reason
        finish = choice.finish_reason
        if any(isinstance(b, ToolUseBlock) for b in content):
            stop: StopReason = "tool_use"
        elif finish == "stop":
            stop = "end_turn"
        elif finish == "length":
            stop = "max_tokens"
        else:
            stop = "other"

        usage = resp.usage
        return LLMResponse(
            content=content,
            stop_reason=stop,
            input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
            output_tokens=getattr(usage, "completion_tokens", 0) or 0,
            raw=resp,
        )


def _gen_id() -> str:
    return f"call_{uuid.uuid4().hex[:12]}"


def _anthropic_to_openai_tool(tool: dict) -> dict:
    """{name, description, input_schema} → OpenAI function-tool shape."""
    return {
        "type": "function",
        "function": {
            "name": tool["name"],
            "description": tool.get("description", ""),
            "parameters": tool.get("input_schema") or {"type": "object", "properties": {}},
        },
    }


def _anthropic_to_openai_messages(messages: list[dict]) -> list[dict]:
    """Convert Anthropic-style messages (with content blocks) to OpenAI shape.

    - assistant messages with text + tool_use blocks → assistant with `tool_calls`
    - user messages with tool_result blocks → multiple `tool` messages (one per result)
    - plain string content → straight content
    """
    out: list[dict] = []
    for m in messages:
        role = m["role"]
        content = m["content"]

        if isinstance(content, str):
            out.append({"role": role, "content": content})
            continue

        if not isinstance(content, list):
            out.append({"role": role, "content": str(content)})
            continue

        if role == "assistant":
            text_parts: list[str] = []
            tool_calls: list[dict] = []
            for b in content:
                btype = _block_type(b)
                if btype == "text":
                    text_parts.append(_block_field(b, "text") or "")
                elif btype == "tool_use":
                    tool_calls.append({
                        "id": _block_field(b, "id"),
                        "type": "function",
                        "function": {
                            "name": _block_field(b, "name"),
                            "arguments": json.dumps(_block_field(b, "input") or {}),
                        },
                    })
            msg: dict = {"role": "assistant"}
            if text_parts:
                msg["content"] = "\n".join(text_parts)
            else:
                msg["content"] = None
            if tool_calls:
                msg["tool_calls"] = tool_calls
            out.append(msg)

        elif role == "user":
            tool_results: list[dict] = []
            text_parts: list[str] = []
            for b in content:
                btype = _block_type(b)
                if btype == "tool_result":
                    raw_content = _block_field(b, "content")
                    if isinstance(raw_content, list):
                        # Flatten to text
                        text = "\n".join(
                            _block_field(c, "text") or json.dumps(c, default=str)
                            for c in raw_content if c
                        )
                    elif isinstance(raw_content, (dict, list)):
                        text = json.dumps(raw_content, default=str)
                    else:
                        text = str(raw_content) if raw_content is not None else ""
                    tool_results.append({
                        "role": "tool",
                        "tool_call_id": _block_field(b, "tool_use_id"),
                        "content": text,
                    })
                elif btype == "text":
                    text_parts.append(_block_field(b, "text") or "")
            # Tool results must appear as separate `tool` messages
            out.extend(tool_results)
            if text_parts:
                out.append({"role": "user", "content": "\n".join(text_parts)})
        else:
            # Pass through unknown roles
            out.append({"role": role, "content": str(content)})
    return out


def _block_type(block: Any) -> str:
    if isinstance(block, dict):
        return block.get("type", "")
    return getattr(block, "type", "")


def _block_field(block: Any, name: str) -> Any:
    if isinstance(block, dict):
        return block.get(name)
    return getattr(block, name, None)
