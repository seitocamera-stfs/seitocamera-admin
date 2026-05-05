"""Intermediate briefs the Manager sends to each specialist agent."""
from __future__ import annotations
from pydantic import BaseModel, Field

from .business import BusinessContext
from .research import MarketResearch
from .strategy import CampaignStrategy


class ResearchBrief(BaseModel):
    business: BusinessContext
    depth: int = Field(3, ge=1, le=5, description="1=quick scan, 5=deep investigation")
    focus_competitors: list[str] = Field(default_factory=list)
    max_competitors: int = 5


class StrategyBrief(BaseModel):
    business: BusinessContext
    research: MarketResearch
    require_min_angles: int = 3
    budget_tier_hint: str | None = None


class LeadBrief(BaseModel):
    business: BusinessContext
    strategy: CampaignStrategy
    target_count: int = Field(10, ge=1, le=15)
    min_fit_score: int = 6
