"""Smoke test for the Ollama LLM client.

Validates the round-trip:
  1. Send a system + user message + 1 tool definition to Ollama
  2. Receive a ToolUseBlock with parsed input
  3. Send back a tool_result (Anthropic-shaped, converted internally)
  4. Receive a final text response

Run with the venv activated:
  ./.venv/bin/python scripts/smoke_ollama.py
"""
from __future__ import annotations
import asyncio
import json

from src.llm import make_llm_client, ToolUseBlock, TextBlock


WEATHER_TOOL = {
    "name": "get_weather",
    "description": "Get the current weather for a city.",
    "input_schema": {
        "type": "object",
        "properties": {
            "city": {"type": "string", "description": "City name"},
            "unit": {"type": "string", "enum": ["c", "f"], "default": "c"},
        },
        "required": ["city"],
    },
}


async def main() -> None:
    client = make_llm_client("ollama")
    system = "You are a helpful assistant. When asked about weather, ALWAYS call the get_weather tool."
    messages = [{"role": "user", "content": "What's the weather in Barcelona?"}]

    print("→ Calling Ollama (turn 1)...")
    resp1 = await client.call(
        model="qwen3:14b",
        system=system,
        messages=messages,
        tools=[WEATHER_TOOL],
        temperature=0.2,
        max_tokens=1024,
    )
    print(f"  stop_reason: {resp1.stop_reason}")
    print(f"  content blocks: {[type(b).__name__ for b in resp1.content]}")
    for b in resp1.content:
        if isinstance(b, TextBlock):
            print(f"  text: {b.text[:200]}")
        elif isinstance(b, ToolUseBlock):
            print(f"  tool_use: name={b.name}, input={b.input}")

    tool_use = next((b for b in resp1.content if isinstance(b, ToolUseBlock)), None)
    if not tool_use:
        print("\n[FAIL] Model did not call the tool. Tool-use loop won't work.")
        return

    if tool_use.name != "get_weather":
        print(f"\n[FAIL] Unexpected tool name: {tool_use.name}")
        return

    print(f"\n[OK] Tool call detected with input: {tool_use.input}")

    # Round-trip: send tool_result and get final answer
    messages.append({"role": "assistant", "content": [
        {"type": "text", "text": (next((b.text for b in resp1.content if isinstance(b, TextBlock)), "") or "")},
        {"type": "tool_use", "id": tool_use.id, "name": tool_use.name, "input": tool_use.input},
    ]})
    messages.append({"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": tool_use.id, "content": json.dumps({"city": "Barcelona", "temperature": 22, "unit": "c", "conditions": "sunny"})},
    ]})

    print("\n→ Calling Ollama (turn 2, with tool_result)...")
    resp2 = await client.call(
        model="qwen3:14b",
        system=system,
        messages=messages,
        tools=[WEATHER_TOOL],
        temperature=0.2,
        max_tokens=1024,
    )
    print(f"  stop_reason: {resp2.stop_reason}")
    for b in resp2.content:
        if isinstance(b, TextBlock):
            print(f"  text: {b.text[:300]}")
        elif isinstance(b, ToolUseBlock):
            print(f"  tool_use: name={b.name}, input={b.input}")

    print(f"\n[OK] Round-trip complete. Tokens used: in={resp1.input_tokens + resp2.input_tokens}, out={resp1.output_tokens + resp2.output_tokens}")


if __name__ == "__main__":
    asyncio.run(main())
