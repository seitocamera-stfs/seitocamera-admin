"""Budget tracking — hard caps on USD, tokens, tool calls.

Usage:
    budget = BudgetTracker(Budget(max_usd=3.0, max_tokens=400_000, max_tool_calls=150))
    budget.record_llm("claude-sonnet-4-6", in_tokens=5000, out_tokens=1500)
    budget.check()  # raises BudgetExceededError if any cap passed
"""
from __future__ import annotations
from pydantic import BaseModel, Field

from ..settings import settings


class Budget(BaseModel):
    max_usd: float = Field(..., gt=0)
    max_tokens: int = Field(..., gt=0)
    max_tool_calls: int = Field(..., gt=0)


class BudgetExceededError(Exception):
    """Raised when the run exceeds any configured cap."""


_MODEL_PRICING_USD_PER_MTOK: dict[str, tuple[float, float]] = {
    # input_per_mtok, output_per_mtok
    "claude-sonnet-4-6": (settings.price_sonnet_input_per_mtok, settings.price_sonnet_output_per_mtok),
    "claude-opus-4-6": (settings.price_opus_input_per_mtok, settings.price_opus_output_per_mtok),
}


class BudgetTracker:
    def __init__(self, budget: Budget) -> None:
        self.budget = budget
        self.spent_usd = 0.0
        self.spent_tokens = 0
        self.tool_calls = 0
        self.per_agent_usd: dict[str, float] = {}

    def record_llm(self, model: str, in_tokens: int, out_tokens: int, agent: str = "unknown") -> None:
        in_price, out_price = _MODEL_PRICING_USD_PER_MTOK.get(model, (0, 0))
        cost = (in_tokens * in_price + out_tokens * out_price) / 1_000_000
        self.spent_usd += cost
        self.spent_tokens += in_tokens + out_tokens
        self.per_agent_usd[agent] = self.per_agent_usd.get(agent, 0.0) + cost

    def record_tool(self) -> None:
        self.tool_calls += 1

    def remaining_usd(self) -> float:
        return max(0.0, self.budget.max_usd - self.spent_usd)

    def check(self) -> None:
        if self.spent_usd >= self.budget.max_usd:
            raise BudgetExceededError(f"USD cap hit: spent {self.spent_usd:.2f}/{self.budget.max_usd:.2f}")
        if self.spent_tokens >= self.budget.max_tokens:
            raise BudgetExceededError(f"Token cap hit: {self.spent_tokens}/{self.budget.max_tokens}")
        if self.tool_calls >= self.budget.max_tool_calls:
            raise BudgetExceededError(f"Tool call cap hit: {self.tool_calls}/{self.budget.max_tool_calls}")
