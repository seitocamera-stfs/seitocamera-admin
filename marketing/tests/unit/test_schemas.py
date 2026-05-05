"""Schema validation tests.

Purpose: lock the contracts. A failing test here means the data model the
agents rely on has shifted and something upstream or downstream will break.
"""
from __future__ import annotations
import json
from datetime import datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from src.schemas import (
    BusinessContext,
    Competitor,
    MarketResearch,
    MarketOpportunity,
    Source,
)


def test_business_context_loads_seito_example() -> None:
    path = Path(__file__).parents[2] / "examples" / "seito_camera.json"
    ctx = BusinessContext.model_validate(json.loads(path.read_text()))
    assert ctx.name == "Seito Camera"
    assert ctx.language == "ca"
    assert len(ctx.known_competitors) == 5


def test_source_rejects_long_excerpt() -> None:
    with pytest.raises(ValidationError):
        Source(
            url="https://example.com/",
            retrieved_at=datetime.utcnow(),
            excerpt="x" * 301,
        )


def test_competitor_requires_at_least_one_source() -> None:
    with pytest.raises(ValidationError):
        Competitor(
            name="Foo",
            positioning="Bar",
            sources=[],
        )


def test_market_research_requires_min_competitors_and_opportunities() -> None:
    now = datetime.utcnow()
    source = Source(url="https://example.com/", retrieved_at=now)
    comp = Competitor(name="X", positioning="Y", sources=[source])

    with pytest.raises(ValidationError):
        MarketResearch(
            business="Seito Camera",
            vertical="rental",
            geography="BCN",
            competitors=[comp, comp],  # only 2, need ≥3
            price_summary="",
            channel_summary="",
            opportunities=[MarketOpportunity(description="x", rationale="y", evidence=[source])],
            generated_at=now,
            tokens_used=0,
        )
