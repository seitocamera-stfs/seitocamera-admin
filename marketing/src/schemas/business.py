"""Input from the Director to the Manager."""
from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field, HttpUrl


class BusinessContext(BaseModel):
    """What the Director tells the Manager about the business."""

    name: str = Field(..., description="Business name, e.g. 'Seito Camera'")
    description: str = Field(..., min_length=30, description="Plain-language description of what the business sells")
    vertical: str = Field(..., description="Industry vertical")
    location: str = Field(..., description="Primary geographic market")
    target_customers: list[str] = Field(..., min_length=1, description="Buyer personas")
    unique_strengths: list[str] = Field(default_factory=list)
    known_competitors: list[str] = Field(default_factory=list)
    language: Literal["ca", "es", "en"] = "ca"
    website: HttpUrl | None = None
    goals: list[str] = Field(default_factory=list)
    excluded_segments: list[str] = Field(default_factory=list)
