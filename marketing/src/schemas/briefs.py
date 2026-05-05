"""Intermediate briefs the Manager sends to each specialist agent."""
from __future__ import annotations
from pydantic import BaseModel, Field

from .business import BusinessContext
from .research import MarketResearch
from .strategy import CampaignStrategy
from .leads import LeadList


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


class VerificationBrief(BaseModel):
    """What the Fact-Checker receives: the bundle of artifacts to audit.

    All three artifacts are optional so the checker can audit any subset
    (e.g. just the Investigator's MarketResearch when running stage-by-stage).
    At least one must be present.
    """
    business: BusinessContext
    research: MarketResearch | None = None
    strategy: CampaignStrategy | None = None
    leads: LeadList | None = None
    max_claims_to_check: int = Field(20, ge=1, le=100, description="Cap on claims to verify per run (cost control)")
