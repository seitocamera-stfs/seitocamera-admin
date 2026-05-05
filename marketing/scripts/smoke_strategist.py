"""Smoke test for Strategist agent on Seito Camera.

Pulls BusinessContext from the SeitoCamera Admin API.
Loads the latest Investigator output (`out/investigator_*.json`) as the
MarketResearch input. If none exists, falls back to a minimal mock.

Run: ./.venv/bin/python scripts/smoke_strategist.py
"""
from __future__ import annotations
import asyncio
import json
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from src.schemas.briefs import StrategyBrief
from src.schemas.research import MarketResearch
from src.orchestration.budget import Budget, BudgetTracker
from src.agents.strategist import Strategist
from src.settings import settings
from src.admin_client import fetch_company_context, context_to_business, AdminApiError


def latest_investigator_output() -> Path | None:
    out_dir = Path("out")
    if not out_dir.exists():
        return None
    files = sorted(
        out_dir.glob("investigator_smoke_*.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return files[0] if files else None


async def main() -> None:
    print(f"=== Strategist smoke test ===")
    print(f"LLM provider: {settings.llm_provider}")
    print(f"Model:        {settings.model_strategist}")
    print()

    try:
        admin_ctx = fetch_company_context()
        ctx = context_to_business(admin_ctx)
    except AdminApiError as e:
        print(f"[FAIL] Could not fetch from admin API: {e}")
        return

    print(f"Business: {ctx.name} — {ctx.vertical}")
    print(f"Language: {ctx.language}")

    # Load research from latest investigator output
    research_file = latest_investigator_output()
    if research_file:
        research = MarketResearch.model_validate(json.loads(research_file.read_text()))
        print(f"Research: {research_file.name} ({len(research.competitors)} competitors)")
    else:
        print("[FAIL] No investigator output found at out/investigator_smoke_*.json")
        print("Tip: run scripts/smoke_investigator.py first")
        return
    print()

    brief = StrategyBrief(
        business=ctx,
        research=research,
        require_min_angles=3,
    )

    budget = BudgetTracker(Budget(
        max_usd=settings.max_usd_per_run,
        max_tokens=settings.max_tokens_per_run,
        max_tool_calls=settings.max_tool_calls_per_run,
    ))
    agent = Strategist(budget)

    print(f"→ Running Strategist (temperature {agent.temperature})...")
    t0 = time.time()
    try:
        strategy = await agent.run(brief)
    except Exception as e:
        print(f"\n[FAIL] {type(e).__name__}: {e}")
        return

    elapsed = time.time() - t0

    out_file = Path(f"out/strategist_smoke_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    out_file.parent.mkdir(exist_ok=True)
    out_file.write_text(strategy.model_dump_json(indent=2))

    print(f"\n[OK] Completed in {elapsed:.1f}s")
    print(f"     Tokens: {budget.spent_tokens}")
    print(f"     Tool calls: {budget.tool_calls}")

    print(f"\n--- Considered angles ({len(strategy.considered_angles)}) ---")
    for a in strategy.considered_angles:
        marker = "★" if a.label == strategy.chosen_angle.label else " "
        print(f"  {marker} {a.label} ({a.estimated_fit})")
        print(f"    Pitch: {a.pitch[:120]}")

    print(f"\n--- Chosen angle ---")
    print(f"  {strategy.chosen_angle.label}")
    print(f"  Diff: {strategy.chosen_angle.differentiation_vs_competitors[:200]}")

    print(f"\n--- Key message ---")
    print(f"  {strategy.key_message}")

    print(f"\n--- Channels ({len(strategy.channels)}) ---")
    for c in strategy.channels:
        print(f"  • {c.channel} ({c.cadence}) → KPI: {c.primary_kpi}")

    print(f"\n--- Target segments ---")
    for s in strategy.target_segments:
        print(f"  • {s}")

    print(f"\n--- Success metrics ---")
    for m in strategy.success_metrics:
        print(f"  • {m}")

    print(f"\nCreativity notes: {strategy.creativity_notes[:300]}")
    print(f"Budget tier: {strategy.budget_tier} · Timing: {strategy.timing}")
    print(f"\nFull output → {out_file}")


if __name__ == "__main__":
    asyncio.run(main())
