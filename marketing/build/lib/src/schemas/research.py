"""Output of the Investigator agent."""
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, Field, HttpUrl, field_validator


class Source(BaseModel):
    """A verifiable source for a factual claim — mandatory for every fact in an agent output."""

    url: HttpUrl
    title: str | None = None
    retrieved_at: datetime
    excerpt: str | None = Field(None, description="Short quote supporting the claim (<300 chars)")

    @field_validator("excerpt")
    @classmethod
    def excerpt_length(cls, v: str | None) -> str | None:
        if v and len(v) > 300:
            raise ValueError("excerpt must be <=300 chars")
        return v


class PriceRange(BaseModel):
    low_eur: float | None = None
    high_eur: float | None = None
    unit: str = Field(..., description="e.g. 'per day', 'per week', 'per production'")
    notes: str | None = None


class Competitor(BaseModel):
    name: str
    website: HttpUrl | None = None
    positioning: str = Field(..., description="One-sentence positioning as observed")
    price_range: PriceRange | None = None
    primary_channels: list[str] = Field(default_factory=list)
    content_style: str | None = None
    observed_strengths: list[str] = Field(default_factory=list)
    observed_weaknesses: list[str] = Field(default_factory=list)
    sources: list[Source] = Field(..., min_length=1, description="MUST have at least one source")


class MarketOpportunity(BaseModel):
    description: str
    rationale: str
    evidence: list[Source] = Field(..., min_length=1)


class MarketResearch(BaseModel):
    business: str
    vertical: str
    geography: str
    competitors: list[Competitor] = Field(..., min_length=3, max_length=8)
    price_summary: str
    channel_summary: str
    opportunities: list[MarketOpportunity] = Field(..., min_length=2)
    risks: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    generated_at: datetime
    tokens_used: int = Field(..., ge=0)
