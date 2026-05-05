"""Strategist agent. Produces CampaignStrategy given business + MarketResearch.

Key behaviors (per prompt):
- MUST generate ≥3 considered_angles before choosing
- creativity_notes MUST be non-empty and specific
- ≤4 channels (focus beats breadth)
- Web search LIMITED — only for validating a creative hypothesis
"""
from __future__ import annotations

from ..schemas.briefs import StrategyBrief
from ..schemas.strategy import CampaignStrategy
from ..tools.base import ToolContext
from ..tools.web_search import WebSearch, WEB_SEARCH_TOOL_DEFINITION, WebSearchInput
from .base import Agent


class Strategist(Agent[StrategyBrief, CampaignStrategy]):
    name = "strategist"
    prompt_file = "strategist"
    input_schema = StrategyBrief
    output_schema = CampaignStrategy
    # Higher temperature for divergent creative thinking (default 0.2 too safe)
    temperature = 0.7

    def __init__(self, budget, model=None) -> None:
        super().__init__(budget, model)
        self._web_search = WebSearch()
        self._ctx = ToolContext(run_id="local", agent=self.name)
        self.tools = [WEB_SEARCH_TOOL_DEFINITION]
        self.tool_executors = {"web_search": self._run_web_search}

    async def _run_web_search(self, input_dict: dict) -> dict:
        out = await self._web_search.execute(WebSearchInput(**input_dict), self._ctx)
        return out.model_dump(mode="json")

    def _initial_message(self, brief: StrategyBrief, feedback: str | None) -> str:
        research = brief.research
        biz = brief.business
        parts = [
            f"Business: {biz.name}",
            f"Language: {biz.language}",
            f"Unique strengths: {', '.join(biz.unique_strengths) if biz.unique_strengths else '(none provided)'}",
            f"Goals: {', '.join(biz.goals) if biz.goals else '(none)'}",
            f"Excluded segments: {', '.join(biz.excluded_segments) if biz.excluded_segments else '(none)'}",
            "",
            f"Market research available. Summary:",
            f"- {len(research.competitors)} competitors analyzed: {', '.join(c.name for c in research.competitors)}",
            f"- Price landscape: {research.price_summary[:300]}",
            f"- Channel landscape: {research.channel_summary[:300]}",
            f"- Detected opportunities ({len(research.opportunities)}):",
        ]
        for i, opp in enumerate(research.opportunities, 1):
            parts.append(f"  {i}. {opp.description}")
        parts.append("")
        parts.append(
            f"Generate ≥{brief.require_min_angles} distinct campaign angles, choose one with explicit "
            f"rationale, and design ≤4 channels that match the chosen angle. Free-text fields in "
            f"{biz.language}. Call return_result when done."
        )
        if brief.budget_tier_hint:
            parts.append(f"Budget tier hint from Director: {brief.budget_tier_hint}")
        if feedback:
            parts.append("")
            parts.append(f"REVISION FEEDBACK: {feedback}")
        return "\n".join(parts)

    def _build_return_tool(self) -> dict:
        angle_schema = {
            "type": "object",
            "properties": {
                "label": {"type": "string"},
                "pitch": {"type": "string"},
                "differentiation_vs_competitors": {"type": "string"},
                "estimated_fit": {"type": "string", "enum": ["low", "medium", "high"]},
                "rationale": {"type": "string"},
            },
            "required": ["label", "pitch", "differentiation_vs_competitors", "estimated_fit", "rationale"],
        }
        channel_schema = {
            "type": "object",
            "properties": {
                "channel": {"type": "string"},
                "why": {"type": "string"},
                "format": {"type": "string"},
                "cadence": {"type": "string"},
                "primary_kpi": {"type": "string"},
            },
            "required": ["channel", "why", "format", "cadence", "primary_kpi"],
        }
        return {
            "name": "return_result",
            "description": (
                "Emit the final CampaignStrategy. Call exactly once when done. "
                "MUST include ≥3 considered_angles, a chosen_angle (may equal one of the considered), "
                "1-4 channels, and non-empty creativity_notes (≥20 chars) explaining how you avoided "
                "mediocre defaults. Free-text fields in the business language."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "business": {"type": "string"},
                    "considered_angles": {
                        "type": "array",
                        "minItems": 3,
                        "items": angle_schema,
                    },
                    "chosen_angle": angle_schema,
                    "key_message": {"type": "string"},
                    "target_segments": {"type": "array", "minItems": 1, "items": {"type": "string"}},
                    "channels": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 4,
                        "items": channel_schema,
                    },
                    "timing": {"type": "string"},
                    "budget_tier": {"type": "string", "enum": ["lean", "moderate", "aggressive"]},
                    "success_metrics": {"type": "array", "minItems": 2, "items": {"type": "string"}},
                    "creativity_notes": {"type": "string"},
                    "generated_at": {"type": "string"},
                    "tokens_used": {"type": "integer"},
                },
                "required": [
                    "business",
                    "considered_angles",
                    "chosen_angle",
                    "key_message",
                    "target_segments",
                    "channels",
                    "timing",
                    "budget_tier",
                    "success_metrics",
                    "creativity_notes",
                    "generated_at",
                    "tokens_used",
                ],
            },
        }
