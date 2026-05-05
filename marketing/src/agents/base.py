"""Base class for all specialist agents.

Design:
- Each agent has a system prompt, an input schema, an output schema, a set of tools.
- Agent.run() runs a tool-use loop via a provider-agnostic LLMClient until the
  model calls the special `return_result` tool with structured JSON matching
  the output schema.
- Schema violations trigger one retry with explicit feedback.
- Every LLM call and tool call is recorded in the BudgetTracker; the tracker
  raises BudgetExceededError when any cap is hit.
- LLM provider is selected via `settings.llm_provider` ("anthropic" | "ollama").
"""
from __future__ import annotations
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Generic, TypeVar, Any

from pydantic import BaseModel, ValidationError

from ..settings import settings
from ..orchestration.budget import BudgetTracker, BudgetExceededError
from ..llm import make_llm_client, TextBlock, ToolUseBlock
from ..utils.language import polish_dict
from ..tools.base import UNTRUSTED_TOOL_NAMES, UNTRUSTED_CONTENT_PREAMBLE, wrap_untrusted

InputT = TypeVar("InputT", bound=BaseModel)
OutputT = TypeVar("OutputT", bound=BaseModel)


class SchemaValidationError(Exception):
    """LLM returned JSON that does not validate against the output schema."""


class WeakOutputError(Exception):
    """Output is schema-valid but fails business invariants."""


class Agent(ABC, Generic[InputT, OutputT]):
    """Base specialist agent with a provider-agnostic tool-use loop."""

    name: str
    prompt_file: str
    input_schema: type[InputT]
    output_schema: type[OutputT]

    # Subclasses fill in:
    tools: list[dict]             # Tool definitions in Anthropic shape: {name, description, input_schema}
    tool_executors: dict          # name -> async callable(input_dict) -> dict

    # Default sampling. Subclasses override (Strategist uses 0.7, etc.).
    temperature: float = 0.2

    def __init__(self, budget: BudgetTracker, model: str | None = None) -> None:
        self.model = model or getattr(settings, f"model_{self.name}")
        self.budget = budget
        self.client = make_llm_client()  # reads settings.llm_provider
        self._system_prompt = self._load_prompt()

    def _load_prompt(self) -> str:
        path = Path(__file__).parent.parent / "prompts" / f"{self.prompt_file}.md"
        return path.read_text(encoding="utf-8")

    def _render_system(self, brief: InputT) -> str:
        """Substitute {{business.*}} placeholders. Keep it simple; more expressive
        templating can be added later if prompts need logic.

        Always appends `UNTRUSTED_CONTENT_PREAMBLE` so the model knows how to
        treat content from web_search / fetch_url (anti-prompt-injection).
        """
        prompt = self._system_prompt
        lang = getattr(getattr(brief, "business", brief), "language", "ca")
        lang_names = {"ca": "Catalan", "es": "Spanish", "en": "English"}
        lang_name = lang_names.get(lang, lang)
        prompt = prompt.replace("{{business.language_name}}", lang_name)
        prompt = prompt.replace("{{business.language}}", lang)
        return prompt + UNTRUSTED_CONTENT_PREAMBLE

    @abstractmethod
    def _build_return_tool(self) -> dict:
        """Tool definition for `return_result`, using the output schema."""

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
            resp = await self.client.call(
                model=self.model,
                system=system,
                tools=tools,
                messages=messages,
                temperature=self.temperature,
                max_tokens=8192,
            )
            self.budget.record_llm(
                self.model,
                in_tokens=resp.input_tokens,
                out_tokens=resp.output_tokens,
                agent=self.name,
            )

            tool_use_blocks = [b for b in resp.content if isinstance(b, ToolUseBlock)]
            if resp.stop_reason == "end_turn" and not tool_use_blocks:
                texts = [b.text for b in resp.content if isinstance(b, TextBlock)]
                # Donem una segona oportunitat: a vegades models locals (Qwen3) emeten
                # text en lloc de cridar el tool. Reforcem la instrucció una vegada.
                # Si torna a fallar al següent torn, ja s'aixecarà l'excepció final
                # quan acabin els torns.
                if not texts or all(not t.strip() for t in texts):
                    nudge = (
                        "Your previous turn produced no usable output. You MUST call the "
                        "`return_result` tool now with the final structured JSON. Do not "
                        "emit free text. Call the tool."
                    )
                else:
                    nudge = (
                        "You emitted text but did not call `return_result`. The system "
                        "only accepts structured tool output. Call `return_result` now "
                        "with the final JSON matching the output schema."
                    )
                # Append assistant content (potentially empty) to history first
                messages.append({"role": "assistant", "content": _blocks_to_dicts(resp.content) or [{"type": "text", "text": "(empty)"}]})
                messages.append({"role": "user", "content": nudge})
                continue

            # Append assistant turn (preserve content blocks for round-trip)
            messages.append({"role": "assistant", "content": _blocks_to_dicts(resp.content)})

            tool_results: list[dict] = []
            retry_after_validation = False
            for block in tool_use_blocks:
                if block.name == "return_result":
                    try:
                        # Apply language post-processor (catalanismes, etc.) to
                        # all string fields BEFORE schema validation, so the
                        # cleaned output is what's saved AND what's passed to
                        # downstream agents.
                        lang = getattr(getattr(brief, "business", brief), "language", "ca")
                        cleaned = polish_dict(block.input, lang)
                        return self.output_schema.model_validate(cleaned)
                    except ValidationError as e:
                        messages.append({
                            "role": "user",
                            "content": [{
                                "type": "tool_result",
                                "tool_use_id": block.id,
                                "is_error": True,
                                "content": f"Schema validation failed. Fix these errors and call return_result again:\n{e}",
                            }],
                        })
                        retry_after_validation = True
                        break

                executor = self.tool_executors.get(block.name)
                if not executor:
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "is_error": True,
                        "content": f"Unknown tool: {block.name}",
                    })
                    continue

                self.budget.record_tool()
                try:
                    result = await executor(block.input)
                    serialized = _serialize_tool_output(result)
                    # Tools que retornen contingut external (web pages, search snippets)
                    # passen pel wrapper anti-prompt-injection. La resta van crues.
                    if block.name in UNTRUSTED_TOOL_NAMES:
                        serialized = wrap_untrusted(serialized, block.name)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": serialized,
                    })
                except BudgetExceededError:
                    raise
                except Exception as e:
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "is_error": True,
                        "content": f"{type(e).__name__}: {e}",
                    })

            if retry_after_validation:
                continue
            if tool_results:
                messages.append({"role": "user", "content": tool_results})

        raise SchemaValidationError(f"{self.name} exceeded max turns ({max_turns}) without returning result")


def _blocks_to_dicts(content: list[Any]) -> list[dict]:
    """Convert normalized blocks back to dicts for the messages history."""
    out = []
    for b in content:
        if isinstance(b, TextBlock):
            out.append({"type": "text", "text": b.text})
        elif isinstance(b, ToolUseBlock):
            out.append({"type": "tool_use", "id": b.id, "name": b.name, "input": b.input})
    return out


def _serialize_tool_output(obj: Any) -> str:
    """Serialize a Pydantic model or dict to JSON string for tool_result content."""
    import json

    if isinstance(obj, BaseModel):
        return obj.model_dump_json()
    return json.dumps(obj, default=str)
