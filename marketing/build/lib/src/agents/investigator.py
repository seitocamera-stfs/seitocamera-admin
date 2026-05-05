"""Investigator agent. Produces MarketResearch given a ResearchBrief.

Tools available to the LLM:
- web_search: broad and targeted queries
- fetch_url: retrieve page text
- return_result: emit the final MarketResearch JSON (terminates the loop)
"""
from __future__ import annotations
from datetime import datetime

from ..schemas.briefs import ResearchBrief
from ..schemas.research import MarketResearch
from ..tools.base import ToolContext
from ..tools.web_search import WebSearch, WEB_SEARCH_TOOL_DEFINITION, WebSearchInput
from ..tools.fetch_url import FetchUrl, FETCH_URL_TOOL_DEFINITION, FetchUrlInput
from .base import Agent


class Investigator(Agent[ResearchBrief, MarketResearch]):
    name = "investigator"
    prompt_file = "investigator"
    input_schema = ResearchBrief
    output_schema = MarketResearch

    def __init__(self, budget, model=None) -> None:
        super().__init__(budget, model)
        self._web_search = WebSearch()
        self._fetch_url = FetchUrl()
        self._ctx = ToolContext(run_id="local", agent=self.name)
        self.tools = [WEB_SEARCH_TOOL_DEFINITION, FETCH_URL_TOOL_DEFINITION]
        self.tool_executors = {
            "web_search": self._run_web_search,
            "fetch_url": self._run_fetch_url,
        }

    async def _run_web_search(self, input_dict: dict) -> dict:
        out = await self._web_search.execute(WebSearchInput(**input_dict), self._ctx)
        return out.model_dump(mode="json")

    async def _run_fetch_url(self, input_dict: dict) -> dict:
        out = await self._fetch_url.execute(FetchUrlInput(**input_dict), self._ctx)
        return out.model_dump(mode="json")

    def _initial_message(self, brief: ResearchBrief, feedback: str | None) -> str:
        parts = [
            f"Business: {brief.business.name}",
            f"Description: {brief.business.description}",
            f"Vertical: {brief.business.vertical}",
            f"Location: {brief.business.location}",
            f"Target customers: {', '.join(brief.business.target_customers)}",
        ]
        if brief.business.unique_strengths:
            parts.append(f"Unique strengths: {', '.join(brief.business.unique_strengths)}")
        if brief.business.known_competitors:
            parts.append(f"Known competitors (seeds): {', '.join(brief.business.known_competitors)}")
        if brief.business.excluded_segments:
            parts.append(f"Excluded segments: {', '.join(brief.business.excluded_segments)}")
        parts.append(f"Output language: {brief.business.language}")
        parts.append(f"Depth: {brief.depth}/5. Max competitors in output: {brief.max_competitors}.")
        parts.append("")
        parts.append(
            "Follow the methodology in your system prompt. Use web_search and fetch_url to build "
            "evidence. When ready, call return_result with a valid MarketResearch object."
        )
        if feedback:
            parts.append("")
            parts.append(f"REVISION FEEDBACK (previous attempt was rejected): {feedback}")
        return "\n".join(parts)

    def _build_return_tool(self) -> dict:
        # We hand the LLM a loose schema and rely on Pydantic for strict validation.
        return {
            "name": "return_result",
            "description": (
                "Emit the final MarketResearch result. Call this exactly once when your "
                "analysis is complete. Must match the MarketResearch schema. Every Competitor "
                "must have at least one source. Every MarketOpportunity must have at least one "
                "evidence source. Include `generated_at` (ISO timestamp) and `tokens_used` "
                "(your best estimate, integer)."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "business": {"type": "string"},
                    "vertical": {"type": "string"},
                    "geography": {"type": "string"},
                    "competitors": {
                        "type": "array",
                        "minItems": 3,
                        "maxItems": 8,
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "website": {"type": ["string", "null"]},
                                "positioning": {"type": "string"},
                                "price_range": {"type": ["object", "null"]},
                                "primary_channels": {"type": "array", "items": {"type": "string"}},
                                "content_style": {"type": ["string", "null"]},
                                "observed_strengths": {"type": "array", "items": {"type": "string"}},
                                "observed_weaknesses": {"type": "array", "items": {"type": "string"}},
                                "sources": {
                                    "type": "array",
                                    "minItems": 1,
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "url": {"type": "string"},
                                            "title": {"type": ["string", "null"]},
                                            "retrieved_at": {"type": "string"},
                                            "excerpt": {"type": ["string", "null"]},
                                        },
                                        "required": ["url", "retrieved_at"],
                                    },
                                },
                            },
                            "required": ["name", "positioning", "sources"],
                        },
                    },
                    "price_summary": {"type": "string"},
                    "channel_summary": {"type": "string"},
                    "opportunities": {
                        "type": "array",
                        "minItems": 2,
                        "items": {
                            "type": "object",
                            "properties": {
                                "description": {"type": "string"},
                                "rationale": {"type": "string"},
                                "evidence": {
                                    "type": "array",
                                    "minItems": 1,
                                    "items": {"type": "object"},
                                },
                            },
                            "required": ["description", "rationale", "evidence"],
                        },
                    },
                    "risks": {"type": "array", "items": {"type": "string"}},
                    "open_questions": {"type": "array", "items": {"type": "string"}},
                    "generated_at": {"type": "string"},
                    "tokens_used": {"type": "integer"},
                },
                "required": [
                    "business",
                    "vertical",
                    "geography",
                    "competitors",
                    "price_summary",
                    "channel_summary",
                    "opportunities",
                    "generated_at",
                    "tokens_used",
                ],
            },
        }
