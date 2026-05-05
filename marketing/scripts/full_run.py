"""Full marketing AI run — orchestrates all 4 agents in sequence.

Pipeline:
  1. Investigator → MarketResearch
  2. Strategist (with research) → CampaignStrategy
  3. Lead Hunter (with strategy) → LeadList
  4. Fact-Checker (with all 3) → VerificationReport

Each stage's output is saved to `out/full_run_{timestamp}/{stage}.json` so
they can be inspected individually. A consolidated `executive_report.json`
combines the bundle + verification at the end.

Total expected time: 35-50 min on qwen3:32b.

Run: ./.venv/bin/python scripts/full_run.py
Skip stages with --skip-investigator / --skip-strategist / --skip-leads /
                  --skip-fact-checker (useful for resume after partial run).
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

from src.schemas.briefs import ResearchBrief, StrategyBrief, LeadBrief, VerificationBrief
from src.orchestration.budget import Budget, BudgetTracker
from src.agents.investigator import Investigator
from src.agents.strategist import Strategist
from src.agents.lead_hunter import LeadHunter
from src.agents.fact_checker import FactChecker
from src.settings import settings
from src.admin_client import fetch_company_context, context_to_business, AdminApiError


SKIP = {a[7:] for a in sys.argv if a.startswith("--skip-")}


def banner(text: str) -> None:
    print(f"\n{'=' * 60}\n  {text}\n{'=' * 60}")


async def main() -> None:
    banner("FULL MARKETING RUN")
    print(f"Provider: {settings.llm_provider}")
    print(f"Models: investigator={settings.model_investigator}, strategist={settings.model_strategist}, lead_hunter={settings.model_lead_hunter}, fact_checker={settings.model_fact_checker}")

    # Load business context from admin API
    try:
        admin_ctx = fetch_company_context()
        ctx = context_to_business(admin_ctx)
    except AdminApiError as e:
        print(f"\n[FAIL] Cannot load business context from admin: {e}")
        return
    print(f"\nBusiness: {ctx.name} — {ctx.vertical} ({ctx.location}, lang={ctx.language})")

    # Output directory
    run_dir = Path(f"out/full_run_{datetime.now().strftime('%Y%m%d_%H%M%S')}")
    run_dir.mkdir(parents=True, exist_ok=True)
    print(f"Output dir: {run_dir}")

    # Single budget shared across all stages
    budget = BudgetTracker(Budget(
        max_usd=settings.max_usd_per_run,
        max_tokens=settings.max_tokens_per_run,
        max_tool_calls=settings.max_tool_calls_per_run,
    ))

    research = strategy = leads = verification = None
    timings: dict[str, float] = {}

    # ---- Stage 1: Investigator ---------------------------------------
    if "investigator" not in SKIP:
        banner("Stage 1/4: Investigator")
        brief = ResearchBrief(business=ctx, depth=2, max_competitors=4)
        agent = Investigator(budget)
        t0 = time.time()
        try:
            research = await agent.run(brief)
            timings["investigator"] = time.time() - t0
            (run_dir / "1_research.json").write_text(research.model_dump_json(indent=2))
            print(f"[OK] {timings['investigator']:.0f}s · {len(research.competitors)} competitors")
        except Exception as e:
            print(f"[FAIL] Investigator: {type(e).__name__}: {e}")
            print("Aborting full run — Strategist needs research.")
            return
    else:
        print("\n[skip] Investigator")

    # ---- Stage 2: Strategist -----------------------------------------
    if "strategist" not in SKIP and research:
        banner("Stage 2/4: Strategist")
        brief = StrategyBrief(business=ctx, research=research, require_min_angles=3)
        agent = Strategist(budget)
        t0 = time.time()
        try:
            strategy = await agent.run(brief)
            timings["strategist"] = time.time() - t0
            (run_dir / "2_strategy.json").write_text(strategy.model_dump_json(indent=2))
            print(f"[OK] {timings['strategist']:.0f}s · angle: {strategy.chosen_angle.label[:60]}")
        except Exception as e:
            print(f"[FAIL] Strategist: {type(e).__name__}: {e}")
            print("Continuing without strategy — Lead Hunter will be skipped.")
    elif not research:
        print("\n[skip] Strategist (no research available)")

    # ---- Stage 3: Lead Hunter ----------------------------------------
    if "leads" not in SKIP and strategy:
        banner("Stage 3/4: Lead Hunter")
        brief = LeadBrief(business=ctx, strategy=strategy, target_count=5, min_fit_score=5)
        agent = LeadHunter(budget)
        t0 = time.time()
        try:
            leads = await agent.run(brief)
            timings["lead_hunter"] = time.time() - t0
            (run_dir / "3_leads.json").write_text(leads.model_dump_json(indent=2))
            print(f"[OK] {timings['lead_hunter']:.0f}s · {len(leads.leads)} leads (rejected {leads.rejected_candidates})")
        except Exception as e:
            print(f"[FAIL] Lead Hunter: {type(e).__name__}: {e}")
    elif not strategy:
        print("\n[skip] Lead Hunter (no strategy available)")

    # ---- Stage 4: Fact-Checker ---------------------------------------
    if "fact-checker" not in SKIP and (research or strategy or leads):
        banner("Stage 4/4: Fact-Checker")
        brief = VerificationBrief(
            business=ctx,
            research=research,
            strategy=strategy,
            leads=leads,
            max_claims_to_check=15,
        )
        agent = FactChecker(budget)
        t0 = time.time()
        try:
            verification = await agent.run(brief)
            timings["fact_checker"] = time.time() - t0
            (run_dir / "4_verification.json").write_text(verification.model_dump_json(indent=2))
            print(f"[OK] {timings['fact_checker']:.0f}s · {verification.verified}/{verification.total_claims} verified")
        except Exception as e:
            print(f"[FAIL] Fact-Checker: {type(e).__name__}: {e}")

    # ---- Final: Executive Report (consolidated bundle) ---------------
    banner("Executive Report")
    executive = {
        "business": ctx.model_dump(mode="json"),
        "research": research.model_dump(mode="json") if research else None,
        "strategy": strategy.model_dump(mode="json") if strategy else None,
        "leads": leads.model_dump(mode="json") if leads else None,
        "verification": verification.model_dump(mode="json") if verification else None,
        "summary": {
            "stages_completed": [k for k in ["investigator", "strategist", "lead_hunter", "fact_checker"]
                                  if k in timings],
            "timings_seconds": {k: round(v, 1) for k, v in timings.items()},
            "total_seconds": round(sum(timings.values()), 1),
            "tokens_used": budget.spent_tokens,
            "tool_calls": budget.tool_calls,
            # Cost tracking — usat pel cap mensual del backend Node
            "spent_usd": round(budget.spent_usd, 4),
            "per_agent_usd": {k: round(v, 4) for k, v in budget.per_agent_usd.items()},
            "fallback_models": sorted(budget.fallback_models),
            "verification_rate": (verification.verified / verification.total_claims) if verification and verification.total_claims else None,
            "blocking_issues": (verification.blocking_issues if verification else []) or [],
        },
        "generated_at": datetime.now().isoformat(),
    }

    # Save in run_dir AND with a top-level alias so the UI shows it as a "run"
    (run_dir / "executive_report.json").write_text(json.dumps(executive, indent=2, default=str))
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    alias = Path(f"out/full_run_{ts}.json")
    alias.write_text(json.dumps(executive, indent=2, default=str))

    # Mirror stage outputs to top-level so they appear in the runs list
    # and (in particular) the leads file can be imported as prospects.
    if research:
        (Path("out") / f"investigator_smoke_{ts}.json").write_text(research.model_dump_json(indent=2))
    if strategy:
        (Path("out") / f"strategist_smoke_{ts}.json").write_text(strategy.model_dump_json(indent=2))
    if leads:
        (Path("out") / f"leads_smoke_{ts}.json").write_text(leads.model_dump_json(indent=2))
    if verification:
        (Path("out") / f"fact_check_smoke_{ts}.json").write_text(verification.model_dump_json(indent=2))

    s = executive["summary"]
    print(f"\nStages: {len(s['stages_completed'])}/4 completed: {', '.join(s['stages_completed'])}")
    print(f"Total time: {s['total_seconds'] / 60:.1f} min · Tokens: {s['tokens_used']}")
    if s["verification_rate"] is not None:
        print(f"Verification rate: {s['verification_rate'] * 100:.1f}%")
    if s["blocking_issues"]:
        print(f"\n⚠ Blocking issues:")
        for b in s["blocking_issues"]:
            print(f"  • {b}")

    print(f"\nFull bundle → {alias}")
    print(f"Stage-by-stage outputs → {run_dir}/")


if __name__ == "__main__":
    asyncio.run(main())
