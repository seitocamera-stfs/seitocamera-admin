"""Final executive report from the Manager to the Director."""
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, Field

from .research import MarketResearch
from .strategy import CampaignStrategy
from .leads import LeadList
from .verification import VerificationReport


class CostBreakdown(BaseModel):
    total_usd: float
    total_tokens: int
    per_agent_usd: dict[str, float]
    tool_calls: int
    web_searches: int


class ExecutiveReport(BaseModel):
    business: str
    run_id: str
    executive_summary: str = Field(..., description="3-5 sentences. Readable in 30 seconds.")
    market_research: MarketResearch
    strategy: CampaignStrategy
    leads: LeadList
    verification: VerificationReport
    flagged_items: list[str] = Field(default_factory=list)
    suggested_next_steps: list[str] = Field(..., min_length=1, max_length=5)
    cost: CostBreakdown
    generated_at: datetime
