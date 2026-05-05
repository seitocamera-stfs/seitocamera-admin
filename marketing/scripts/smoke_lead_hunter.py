"""Smoke test for Lead Hunter agent on Seito Camera.

Pulls BusinessContext from the SeitoCamera Admin API. Since LeadHunter requires
a CampaignStrategy as input (normally produced by the Strategist), we mock a
minimal valid CampaignStrategy aligned with Seito's known positioning. This
lets us validate Lead Hunter end-to-end without depending on a Strategist run.

Run: ./.venv/bin/python scripts/smoke_lead_hunter.py
"""
from __future__ import annotations
import asyncio
import sys
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from src.schemas.briefs import LeadBrief
from src.schemas.strategy import CampaignStrategy, Angle, ChannelPlan
from src.orchestration.budget import Budget, BudgetTracker
from src.agents.lead_hunter import LeadHunter
from src.settings import settings
from src.admin_client import fetch_company_context, context_to_business, AdminApiError


def build_mock_strategy(business_name: str) -> CampaignStrategy:
    """Mock a plausible CampaignStrategy so we can test Lead Hunter without Strategist.

    The shape mirrors what the Strategist would produce. The angle is hand-crafted
    to match Seito's actual positioning (Sant Just hub + ARRI specialization).
    """
    chosen = Angle(
        label="One-stop integrated production at Sant Just",
        pitch="A single coordination point covers cameras, lighting, two adjacent studios, set construction and grip — at one address.",
        differentiation_vs_competitors="No competitor in Barcelona combines rental + adjacent studios + workshop + transport in the same hub.",
        estimated_fit="high",
        rationale="Productoras minimitzen riscos i temps coordinant un únic proveïdor per shoot complet.",
    )
    other_angles = [
        Angle(
            label="ARRI specialist with on-set technical support",
            pitch="ARRI Alexa Mini / Mini LF inventory mantingut i amb suport humà a set.",
            differentiation_vs_competitors="Vs cases generalistes: especialització profunda i fiabilitat.",
            estimated_fit="high",
            rationale="Differentiator clar per produccions exigents.",
        ),
        Angle(
            label="DP-led advisory",
            pitch="El CEO és director de fotografia actiu — assessorament tècnic real.",
            differentiation_vs_competitors="No és un comercial: parla la mateixa llengua que el DP del client.",
            estimated_fit="medium",
            rationale="Dóna confiança a productors i DPs joves.",
        ),
    ]
    return CampaignStrategy(
        business=business_name,
        considered_angles=other_angles + [chosen],
        chosen_angle=chosen,
        key_message="Tot el rodatge cobert en una sola adreça, amb una sola coordinació.",
        target_segments=[
            "Productoras de publicitat a Barcelona",
            "Caps executius/CEOs de productores",
            "Caps de producció freelance",
        ],
        channels=[
            ChannelPlan(
                channel="LinkedIn outreach",
                why="Decision-makers de productores hi són actius.",
                format="Missatge directe amb pitch curt + invitació a visita al hub",
                cadence="3-5 toques personalitzats/setmana",
                primary_kpi="Reunions agendades",
            ),
            ChannelPlan(
                channel="Instagram presence",
                why="Freelancers tècnics audiovisuals hi mantenen portafoli i comunitat.",
                format="Reels mostrant el hub + behind-the-scenes",
                cadence="2 publicacions/setmana",
                primary_kpi="Saved + DMs entrants",
            ),
        ],
        timing="Q2-Q3 2026, abans de la temporada alta de tardor",
        budget_tier="moderate",
        success_metrics=[
            "10+ reunions amb productores noves en 90 dies",
            "3+ comptes nous facturats > 5.000€/projecte",
        ],
        creativity_notes="Pitch focalitzat al one-stop hub que cap competidor pot replicar fàcilment, no en preu.",
        generated_at=datetime.now(),
        tokens_used=0,
    )


async def main() -> None:
    print(f"=== Lead Hunter smoke test ===")
    print(f"LLM provider: {settings.llm_provider}")
    print(f"Model:        {settings.model_lead_hunter}")
    print()

    try:
        admin_ctx = fetch_company_context()
        ctx = context_to_business(admin_ctx)
    except AdminApiError as e:
        print(f"[FAIL] Could not fetch from admin API: {e}")
        return

    print(f"Business: {ctx.name} — {ctx.vertical} ({ctx.location})")
    print(f"Language: {ctx.language}")
    print()

    strategy = build_mock_strategy(ctx.name)
    print(f"Strategy (mocked): {strategy.chosen_angle.label}")
    print(f"Target segments: {', '.join(strategy.target_segments)}")
    print()

    brief = LeadBrief(
        business=ctx,
        strategy=strategy,
        target_count=5,    # short run for smoke
        min_fit_score=5,
    )

    budget = BudgetTracker(Budget(
        max_usd=settings.max_usd_per_run,
        max_tokens=settings.max_tokens_per_run,
        max_tool_calls=settings.max_tool_calls_per_run,
    ))
    agent = LeadHunter(budget)

    print(f"→ Running Lead Hunter (target=5, min_fit=5)...")
    t0 = time.time()
    try:
        leads = await agent.run(brief)
    except Exception as e:
        print(f"\n[FAIL] {type(e).__name__}: {e}")
        return

    elapsed = time.time() - t0

    out_file = Path(f"out/leads_smoke_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    out_file.parent.mkdir(exist_ok=True)
    out_file.write_text(leads.model_dump_json(indent=2))

    print(f"\n[OK] Completed in {elapsed:.1f}s")
    print(f"     Tokens: {budget.spent_tokens}")
    print(f"     Tool calls: {budget.tool_calls}")

    print(f"\n--- {len(leads.leads)} leads found (rejected: {leads.rejected_candidates}) ---")
    for L in leads.leads:
        print(f"  • {L.company_name} (fit {L.fit_score}/10) — {L.location}")
        print(f"    {L.website}")
        print(f"    {L.why_good_fit[:120]}")
        if L.contacts:
            print(f"    contacts: {len(L.contacts)}")
        checks_pass = sum(1 for v in L.validation_checks.values() if v)
        print(f"    validation: {checks_pass}/5 checks passed")

    if leads.rejection_reasons:
        print(f"\n--- Rejection reasons ---")
        for k, v in leads.rejection_reasons.items():
            print(f"  • {k}: {v}")

    print(f"\nFull output → {out_file}")


if __name__ == "__main__":
    asyncio.run(main())
