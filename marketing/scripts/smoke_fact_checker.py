"""Smoke test for Fact-Checker agent on Seito Camera.

Loads the latest outputs of Investigator, Strategist and Lead Hunter (if
available) and audits them. Use --only-research / --only-strategy / --only-leads
to scope to a single artifact.

Run: ./.venv/bin/python scripts/smoke_fact_checker.py
"""
from __future__ import annotations
import asyncio
import json
import sys
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from src.schemas.briefs import VerificationBrief
from src.schemas.research import MarketResearch
from src.schemas.strategy import CampaignStrategy
from src.schemas.leads import LeadList
from src.orchestration.budget import Budget, BudgetTracker
from src.agents.fact_checker import FactChecker
from src.settings import settings
from src.admin_client import fetch_company_context, context_to_business, AdminApiError


def latest_file(pattern: str) -> Path | None:
    files = sorted(Path("out").glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


async def main() -> None:
    print(f"=== Fact-Checker smoke test ===")
    print(f"LLM provider: {settings.llm_provider}")
    print(f"Model:        {settings.model_fact_checker}")
    print()

    only = next((a[7:] for a in sys.argv if a.startswith("--only-")), None)

    try:
        admin_ctx = fetch_company_context()
        ctx = context_to_business(admin_ctx)
    except AdminApiError as e:
        print(f"[FAIL] Could not fetch from admin API: {e}")
        return

    print(f"Business: {ctx.name}")

    research = strategy = leads = None
    if only in (None, "research"):
        f = latest_file("investigator_smoke_*.json")
        if f:
            research = MarketResearch.model_validate(json.loads(f.read_text()))
            print(f"Research: {f.name} ({len(research.competitors)} competitors)")
    if only in (None, "strategy"):
        f = latest_file("strategist_smoke_*.json")
        if f:
            strategy = CampaignStrategy.model_validate(json.loads(f.read_text()))
            print(f"Strategy: {f.name}")
    if only in (None, "leads"):
        f = latest_file("leads_smoke_*.json")
        if f:
            leads = LeadList.model_validate(json.loads(f.read_text()))
            print(f"Leads:    {f.name} ({len(leads.leads)} leads)")
    print()

    if not (research or strategy or leads):
        print("[FAIL] No artifacts to audit. Run other agents first.")
        return

    brief = VerificationBrief(
        business=ctx,
        research=research,
        strategy=strategy,
        leads=leads,
        max_claims_to_check=15,
    )

    budget = BudgetTracker(Budget(
        max_usd=settings.max_usd_per_run,
        max_tokens=settings.max_tokens_per_run,
        max_tool_calls=settings.max_tool_calls_per_run,
    ))
    agent = FactChecker(budget)

    print(f"→ Running Fact-Checker (T={agent.temperature})...")
    t0 = time.time()
    try:
        report = await agent.run(brief)
    except Exception as e:
        print(f"\n[FAIL] {type(e).__name__}: {e}")
        return

    elapsed = time.time() - t0

    out_file = Path(f"out/fact_check_smoke_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    out_file.parent.mkdir(exist_ok=True)
    out_file.write_text(report.model_dump_json(indent=2))

    print(f"\n[OK] Completed in {elapsed:.1f}s")
    print(f"     Tokens: {budget.spent_tokens} · Tool calls: {budget.tool_calls}")

    print(f"\n--- Verification ---")
    print(f"  Total claims: {report.total_claims}")
    print(f"  ✓ Verified:      {report.verified}")
    print(f"  ? Unverifiable:  {report.unverifiable}")
    print(f"  ✗ Contradicted:  {report.contradicted}")
    if report.total_claims:
        print(f"  Verification rate: {(report.verified / report.total_claims) * 100:.1f}%")

    if report.blocking_issues:
        print(f"\n--- Blocking issues ({len(report.blocking_issues)}) ---")
        for b in report.blocking_issues:
            print(f"  • {b}")

    print(f"\n--- Sample claims (first 5) ---")
    for c in report.claims[:5]:
        marker = {"verified": "✓", "unverifiable": "?", "contradicted": "✗"}.get(c.status, "·")
        print(f"  {marker} [{c.agent_source}] {c.claim[:120]}")
        if c.notes:
            print(f"      notes: {c.notes[:120]}")

    print(f"\nFull output → {out_file}")


if __name__ == "__main__":
    asyncio.run(main())
