"""Base types for tools.

Every tool:
- Has a stable `name` exposed to the LLM.
- Has a Pydantic input_schema and output_schema.
- Is async.
- Receives a ToolContext with the run_id, agent name, and budget tracker.
"""
from __future__ import annotations
from typing import Protocol, TypeVar, Generic

from pydantic import BaseModel

InputT = TypeVar("InputT", bound=BaseModel)
OutputT = TypeVar("OutputT", bound=BaseModel)


class ToolContext(BaseModel):
    run_id: str
    agent: str


class ToolError(Exception):
    """Raised when a tool fails after retries."""


class Tool(Protocol, Generic[InputT, OutputT]):
    name: str
    description: str
    input_schema: type[InputT]
    output_schema: type[OutputT]

    async def execute(self, input: InputT, context: ToolContext) -> OutputT: ...
