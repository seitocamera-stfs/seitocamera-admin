"""Output of the Strategist agent."""
from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


class Angle(BaseModel):
    """One strategic angle the Strategist considered."""

    label: str
    pitch: str
    differentiation_vs_competitors: str = Field(
        ..., description="How this angle is NOT already claimed by competitors cited in the research"
    )
    estimated_fit: Literal["low", "medium", "high"]
    rationale: str


class ChannelPlan(BaseModel):
    channel: str
    why: str
    format: str
    cadence: str
    primary_kpi: str


class CampaignStrategy(BaseModel):
    business: str
    considered_angles: list[Angle] = Field(
        ..., min_length=3, description="The Strategist MUST generate at least 3 angles before choosing"
    )
    chosen_angle: Angle
    key_message: str = Field(..., description="One sentence. The thing a prospect should remember.")
    target_segments: list[str] = Field(..., min_length=1)
    channels: list[ChannelPlan] = Field(..., min_length=1, max_length=4)
    timing: str
    budget_tier: Literal["lean", "moderate", "aggressive"]
    success_metrics: list[str] = Field(..., min_length=2)
    creativity_notes: str = Field(
        ..., min_length=20, description="What the Strategist did to avoid mediocrity — required non-empty"
    )
    generated_at: datetime
    tokens_used: int = Field(..., ge=0)
