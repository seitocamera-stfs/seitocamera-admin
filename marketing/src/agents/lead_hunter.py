"""Lead Hunter agent. Produces LeadList given business + MarketResearch + CampaignStrategy.

Key behaviors (per prompt):
- Only include a lead if it passes ≥3 of 5 validation checks
- Do NOT scrape personal LinkedIn profiles at scale — stick to public company pages and website contact info
- For B2B angles targeting freelance decision-makers, LinkedIn company page + role mention is acceptable
- Prefer role-based emails; mark guessed patterns as unverified
"""
from __future__ import annotations

from ..schemas.briefs import LeadBrief
from ..schemas.leads import LeadList
from ..tools.base import ToolContext
from ..tools.web_search import WebSearch, WEB_SEARCH_TOOL_DEFINITION, WebSearchInput
from ..tools.fetch_url import FetchUrl, FETCH_URL_TOOL_DEFINITION, FetchUrlInput
from .base import Agent


class LeadHunter(Agent[LeadBrief, LeadList]):
    name = "lead_hunter"
    prompt_file = "lead_hunter"
    input_schema = LeadBrief
    output_schema = LeadList

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

    def _initial_message(self, brief: LeadBrief, feedback: str | None) -> str:
        biz = brief.business
        strat = brief.strategy
        parts = [
            f"Business: {biz.name}",
            f"Language: {biz.language}",
            f"Location: {biz.location}",
            "",
            "Campaign strategy to target with these leads:",
            f"  Chosen angle: {strat.chosen_angle.label} — {strat.chosen_angle.pitch}",
            f"  Key message: {strat.key_message}",
            f"  Target segments: {', '.join(strat.target_segments)}",
            f"  Channels the outreach will flow through: {', '.join(c.channel for c in strat.channels)}",
            "",
            "Business target_customers:",
        ]
        for tc in biz.target_customers:
            parts.append(f"  - {tc}")
        if biz.excluded_segments:
            parts.append("")
            parts.append("Do NOT include leads from these excluded segments:")
            for ex in biz.excluded_segments:
                parts.append(f"  - {ex}")
        parts.append("")
        parts.append(
            f"Find up to {brief.target_count} leads (companies) that match the strategy. "
            f"For each company, try to identify the most relevant decision-maker (often a line producer "
            f"or cap de producció) and their public contact channel (company email, role-based email, or "
            f"public LinkedIn company page). Score fit 1-10 based on how many strategy criteria they meet. "
            f"Only include leads with fit_score >= {brief.min_fit_score}. "
            f"Validation checks MUST cover: website_reachable, business_active, fits_segment, "
            f"contact_verifiable, not_excluded. Free-text fields in {biz.language}. "
            f"Track rejected candidates and count reasons in rejection_reasons. Call return_result when done."
        )
        if feedback:
            parts.append("")
            parts.append(f"REVISION FEEDBACK: {feedback}")
        return "\n".join(parts)

    def _build_return_tool(self) -> dict:
        contact_schema = {
            "type": "object",
            "properties": {
                "name": {"type": ["string", "null"]},
                "role": {"type": ["string", "null"]},
                "email": {"type": ["string", "null"]},
                "linkedin": {"type": ["string", "null"]},
                "phone": {"type": ["string", "null"]},
                "source": {"type": "string", "description": "URL where this contact was observed"},
            },
            "required": ["source"],
        }
        lead_schema = {
            "type": "object",
            "properties": {
                "company_name": {"type": "string"},
                "website": {"type": "string"},
                "description": {"type": "string"},
                "location": {"type": "string"},
                "size_hint": {"type": ["string", "null"]},
                "why_good_fit": {"type": "string"},
                "fit_score": {"type": "integer", "minimum": 1, "maximum": 10},
                "evidence": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"type": "string", "description": "URL"},
                },
                "contacts": {"type": "array", "items": contact_schema},
                "suggested_outreach": {"type": "string"},
                "validation_checks": {
                    "type": "object",
                    "properties": {
                        "website_reachable": {"type": "boolean"},
                        "business_active": {"type": "boolean"},
                        "fits_segment": {"type": "boolean"},
                        "contact_verifiable": {"type": "boolean"},
                        "not_excluded": {"type": "boolean"},
                    },
                    "required": [
                        "website_reachable",
                        "business_active",
                        "fits_segment",
                        "contact_verifiable",
                        "not_excluded",
                    ],
                },
            },
            "required": [
                "company_name",
                "website",
                "description",
                "location",
                "why_good_fit",
                "fit_score",
                "evidence",
                "suggested_outreach",
                "validation_checks",
            ],
        }
        return {
            "name": "return_result",
            "description": (
                "Emit the final LeadList. Call once when done. leads must contain 1-15 entries, each "
                "with evidence URLs and populated validation_checks. rejected_candidates should reflect "
                "the honest count of candidates you considered and discarded. rejection_reasons is a "
                "histogram of string-keyed counts."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "strategy_reference": {"type": "string"},
                    "leads": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 15,
                        "items": lead_schema,
                    },
                    "rejected_candidates": {"type": "integer", "minimum": 0},
                    "rejection_reasons": {
                        "type": "object",
                        "additionalProperties": {"type": "integer"},
                    },
                    "generated_at": {"type": "string"},
                    "tokens_used": {"type": "integer"},
                },
                "required": [
                    "strategy_reference",
                    "leads",
                    "rejected_candidates",
                    "generated_at",
                    "tokens_used",
                ],
            },
        }
