"""Fact-Checker agent. Audits the bundle of artifacts produced by the other
agents and emits a VerificationReport.

Tools:
- web_search: independent search to corroborate claims
- fetch_url: verify cited URLs resolve and contain claimed content
- return_result: emit the VerificationReport
"""
from __future__ import annotations

from ..schemas.briefs import VerificationBrief
from ..schemas.verification import VerificationReport
from ..tools.base import ToolContext
from ..tools.web_search import WebSearch, WEB_SEARCH_TOOL_DEFINITION, WebSearchInput
from ..tools.fetch_url import FetchUrl, FETCH_URL_TOOL_DEFINITION, FetchUrlInput
from .base import Agent


class FactChecker(Agent[VerificationBrief, VerificationReport]):
    name = "fact_checker"
    prompt_file = "fact_checker"
    input_schema = VerificationBrief
    output_schema = VerificationReport
    # Determinist — no creativity wanted
    temperature = 0.0

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

    def _initial_message(self, brief: VerificationBrief, feedback: str | None) -> str:
        biz = brief.business
        parts = [
            f"Business: {biz.name}",
            f"Language: {biz.language}",
            "",
            "Audit the following artifacts produced by other agents.",
            f"Cap of claims to verify per run: {brief.max_claims_to_check} (focus on highest-impact ones).",
            "",
        ]

        if brief.research:
            parts.append("--- MARKET RESEARCH (Investigator) ---")
            parts.append(f"Competitors ({len(brief.research.competitors)}):")
            for c in brief.research.competitors:
                parts.append(f"  • {c.name}")
                if c.website:
                    parts.append(f"    website: {c.website}")
                parts.append(f"    positioning: {c.positioning[:200]}")
                if c.sources:
                    parts.append(f"    sources: {', '.join(str(s.url) for s in c.sources[:3])}")
            if brief.research.price_summary:
                parts.append(f"Price summary: {brief.research.price_summary}")
            parts.append("")

        if brief.strategy:
            parts.append("--- CAMPAIGN STRATEGY (Strategist) ---")
            parts.append(f"Chosen angle: {brief.strategy.chosen_angle.label}")
            parts.append(f"  pitch: {brief.strategy.chosen_angle.pitch}")
            parts.append(f"  diff: {brief.strategy.chosen_angle.differentiation_vs_competitors}")
            parts.append(f"Key message: {brief.strategy.key_message}")
            parts.append(f"Channels: {', '.join(c.channel for c in brief.strategy.channels)}")
            parts.append("")

        if brief.leads:
            parts.append(f"--- LEADS ({len(brief.leads.leads)}) (Lead Hunter) ---")
            for L in brief.leads.leads:
                parts.append(f"  • {L.company_name} ({L.location}) — fit {L.fit_score}/10")
                parts.append(f"    website: {L.website}")
                if L.contacts:
                    parts.append(f"    contacts: {len(L.contacts)} — first email: {L.contacts[0].email or '(none)'}")
            parts.append("")

        parts.append(
            "Extract factual claims (competitor existence, prices, contact emails, "
            "company status). Verify the most important ones via web_search/fetch_url. "
            "Mark each as verified/unverifiable/contradicted with evidence URLs. "
            "Set blocking_issues if verification_rate < 0.80 or any contact info is "
            "contradicted. Notes in the business language."
        )
        if feedback:
            parts.append("")
            parts.append(f"REVISION FEEDBACK: {feedback}")
        return "\n".join(parts)

    def _build_return_tool(self) -> dict:
        claim_schema = {
            "type": "object",
            "properties": {
                "claim": {"type": "string", "description": "The factual claim being checked"},
                "agent_source": {"type": "string", "enum": ["investigator", "strategist", "lead_hunter"]},
                "status": {"type": "string", "enum": ["verified", "unverifiable", "contradicted"]},
                "evidence_urls": {"type": "array", "items": {"type": "string"}},
                "notes": {"type": ["string", "null"]},
            },
            "required": ["claim", "agent_source", "status"],
        }
        return {
            "name": "return_result",
            "description": (
                "Emit the final VerificationReport. Counts (total/verified/unverifiable/"
                "contradicted) MUST equal the categorization of the `claims` array. "
                "Include `blocking_issues` if verification_rate is below 0.80 or any "
                "contact info is contradicted."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "total_claims": {"type": "integer", "minimum": 0},
                    "verified": {"type": "integer", "minimum": 0},
                    "unverifiable": {"type": "integer", "minimum": 0},
                    "contradicted": {"type": "integer", "minimum": 0},
                    "claims": {
                        "type": "array",
                        "items": claim_schema,
                    },
                    "blocking_issues": {"type": "array", "items": {"type": "string"}},
                    "generated_at": {"type": "string"},
                    "tokens_used": {"type": "integer", "minimum": 0},
                },
                "required": [
                    "total_claims",
                    "verified",
                    "unverifiable",
                    "contradicted",
                    "claims",
                    "generated_at",
                    "tokens_used",
                ],
            },
        }
