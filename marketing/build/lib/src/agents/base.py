"""Base class for all specialist agents.

Design:
- Each agent has a system prompt, an input schema, an output schema, a set of tools.
- Agent.run() runs a tool-use loop with the Anthropic SDK until the model calls the
  special `return_result` tool with a structured JSON matching the output schema.
- Schema violations trigger one retry with explicit feedback.
- Every LLM call and tool call is recorded in the BudgetTracker; the tracker raises
  BudgetExceededError when any cap is hit.
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Generic, TypeVar, Any

from anthropic import Anthropic
from pydantic import BaseModel, ValidationError

from ..settings import settings
from ..orchestration.budget import BudgetTracker, BudgetExceededError

InputT = TypeVar("InputT", bound=BaseModel)
OutputT = TypeVar("OutputT", bound=BaseModel)


class SchemaValidationError(Exception):
    """LLM returned JSON that does not validate against the output schema."""


class WeakOutputError(Exception):
    """Output is schema-valid but fails business invariants."""


class Agent(ABC, Generic[InputT, OutputT]):
    """Base specialist agent with an Anthropic tool-use loop."""

    name: str
    prompt_file: str
    input_schema: type[InputT]
    output_schema: type[OutputT]

    # Subclasses fill in:
    tools: list[dict]             # Anthropic tool definitions (JSON schema)
    tool_executors: dict          # name -> callable(input_dict, context) -> dict

    def __init__(self, budget: BudgetTracker, model: str | None = None) -> None:
        self.model = model or getattr(settings, f"model_{self.name}")
        self.budget = budget
        self.client = Anthropic(api_key=settings.anthropic_api_key)
        self._system_prompt = self._load_prompt()

    def _load_prompt(self) -> str:
        path = Path(__file__).parent.parent / "prompts" / f"{self.prompt_file}.md"
        return path.read_text(encoding="utf-8")

    def _render_system(self, brief: InputT) -> str:
        """Substitute {{business.*}} placeholders. Keep it simple; more expressive
        templating can be added later if prompts need logic."""
        prompt = self._system_prompt
        # Try common substitutions. Non-existing attributes silently skipped.
        lang = getattr(getattr(brief, "business", brief), "language", "ca")
        prompt = prompt.replace("{{business.language}}", lang)
        return prompt

    @abstractmethod
    def _build_return_tool(self) -> dict:
        """Anthropic tool definition for `return_result`, using the output schema."""

    @abstractmethod
    def _initial_message(self, brief: InputT, feedback: str | None) -> str:
        """User message that kicks off the conversation with the agent."""

    async def run(self, brief: InputT, feedback: str | None = None) -> OutputT:
        """Execute the tool-use loop until the model returns structured output."""
        tools = self.tools + [self._build_return_tool()]
        system = self._render_system(brief)
        user_msg = self._initial_message(brief, feedback)

        messages: list[dict] = [{"role": "user", "content": user_msg}]

        max_turns = 25
        for _turn in range(max_turns):
            self.budget.check()
            resp = self.client.messages.create(
                model=self.model,
                max_tokens=4096,
                system=system,
                tools=tools,
                messages=messages,
            )
            self.budget.record_llm(
                self.model,
                in_tokens=resp.usage.input_tokens,
                out_tokens=resp.usage.output_tokens,
                agent=self.name,
            )

            if resp.stop_reason == "end_turn":
                raise SchemaValidationError(
                    f"{self.name} stopped without calling return_result. "
                    f"Text: {''.join(b.text for b in resp.content if hasattr(b, 'text'))[:500]}"
                )

            if resp.stop_reason != "tool_use":
                raise SchemaValidationError(f"Unexpected stop_reason: {resp.stop_reason}")

            # Append assistant turn
            messages.append({"role": "assistant", "content": resp.content})

            tool_results: list[dict] = []
            for block in resp.content:
                if getattr(block, "type", None) != "tool_use":
                    continue

                if block.name == "return_result":
                    # Validate and return
                    try:
                        return self.output_schema.model_validate(block.input)
                    except ValidationError as e:
                        # Retry once with explicit feedback
                        messages.append(
                            {
                                "role": "user",
                                "content": [
                                    {
                                        "type": "tool_result",
                                        "tool_use_id": block.id,
                                        "is_error": True,
                                        "content": f"Schema validation failed. Fix these errors and call return_result again:\n{e}",
                                    }
                                ],
                            }
                        )
                        break  # re-loop

                # Regular tool call
                executor = self.tool_executors.get(block.name)
                if not executor:
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "is_error": True,
                            "content": f"Unknown tool: {block.name}",
                        }
                    )
                    continue

                self.budget.record_tool()
                try:
                    result = await executor(block.input)
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": _serialize_tool_output(result),
                        }
                    )
                except BudgetExceededError:
                    raise
                except Exception as e:
                    tool_results.append(
                        {
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "is_error": True,
                            "content": f"{type(e).__name__}: {e}",
                        }
                    )

            if tool_results:
                messages.append({"role": "user", "content": tool_results})

        raise SchemaValidationError(f"{self.name} exceeded max turns ({max_turns}) without returning result")


def _serialize_tool_output(obj: Any) -> str:
    """Serialize a Pydantic model or dict to JSON string for tool_result content."""
    import json

    if isinstance(obj, BaseModel):
        return obj.model_dump_json()
    return json.dumps(obj, default=str)
