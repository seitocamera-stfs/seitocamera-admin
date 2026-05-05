"""Smoke test for the full Investigator agent on Seito Camera.

Pulls the BusinessContext from the SeitoCamera Admin API
(`/api/company-context`) so the brief always reflects the real database.

Use --from-file to fall back to examples/seito_camera.json (offline mode).

Run: ./.venv/bin/python scripts/smoke_investigator.py
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

from src.schemas.business import BusinessContext
from src.schemas.briefs import ResearchBrief
from src.orchestration.budget import Budget, BudgetTracker
from src.agents.investigator import Investigator
from src.settings import settings
from src.admin_client import fetch_company_context, context_to_business, AdminApiError


async def main() -> None:
    print(f"=== Investigator smoke test ===")
    print(f"LLM provider: {settings.llm_provider}")
    print(f"Model:        {settings.model_investigator}")
    print(f"Ollama URL:   {settings.ollama_base_url}")
    print()

    use_file = "--from-file" in sys.argv
    if use_file:
        business_file = Path("examples/seito_camera.json")
        ctx = BusinessContext.model_validate(json.loads(business_file.read_text()))
        print(f"Source:   examples/seito_camera.json")
    else:
        try:
            admin_ctx = fetch_company_context()
            ctx = context_to_business(admin_ctx)
            fin = admin_ctx.get("financial", {})
            print(f"Source:   admin API ({settings.model_investigator if False else 'http://localhost:4000'})")
            print(f"Revenue {fin.get('year')}: {fin.get('revenue_eur')}€ ({fin.get('invoice_count')} factures)")
            print(f"Top client: {admin_ctx['top_clients'][0]['name'] if admin_ctx.get('top_clients') else '-'}")
        except AdminApiError as e:
            print(f"[FAIL] Could not fetch from admin API: {e}")
            print("Tip: pass --from-file to use examples/seito_camera.json instead.")
            return
    print(f"Business: {ctx.name} — {ctx.vertical} ({ctx.location})")
    print(f"Language: {ctx.language}")
    print()

    brief = ResearchBrief(business=ctx, depth=2, max_competitors=4)  # depth=2 to keep it short

    budget = BudgetTracker(Budget(
        max_usd=settings.max_usd_per_run,
        max_tokens=settings.max_tokens_per_run,
        max_tool_calls=settings.max_tool_calls_per_run,
    ))
    agent = Investigator(budget)

    print(f"→ Running Investigator (depth=2, max_competitors=4)...")
    t0 = time.time()
    try:
        research = await agent.run(brief)
    except Exception as e:
        print(f"\n[FAIL] {type(e).__name__}: {e}")
        return

    elapsed = time.time() - t0

    # Save FIRST — never lose a 14-min run to a print bug
    out_file = Path(f"out/investigator_smoke_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json")
    out_file.parent.mkdir(exist_ok=True)
    out_file.write_text(research.model_dump_json(indent=2))

    print(f"\n[OK] Completed in {elapsed:.1f}s")
    print(f"     Tokens used: {budget.spent_tokens}")
    print(f"     Tool calls: {budget.tool_calls}")
    print(f"     USD spent (only if paid provider): {budget.spent_usd:.4f}")

    # Quality probes
    seeds = {s.lower() for s in ctx.known_competitors}
    found_names = {c.name.lower() for c in research.competitors}
    matched_seeds = [s for s in seeds if any(s in n or n in s for n in found_names)]
    sample_text = (research.competitors[0].positioning if research.competitors else "") + " " + (research.price_summary or "")
    looks_catalan = any(w in sample_text.lower() for w in [" lloguer", " càmera", " preus", " l'", " més ", " amb "])

    print(f"\n--- Quality probes ---")
    print(f"  Seeds in brief: {len(seeds)} → matched in output: {len(matched_seeds)}/{len(seeds)} ({matched_seeds or 'none'})")
    print(f"  Output language looks like Catalan: {'YES' if looks_catalan else 'NO (expected ca)'}")

    print(f"\n--- Output: {len(research.competitors)} competitors ---")
    for c in research.competitors:
        print(f"  • {c.name} — {c.positioning[:80]}")
        print(f"    website: {c.website or '(null)'}")
        print(f"    sources: {len(c.sources)}")

    print(f"\n--- {len(research.opportunities)} opportunities ---")
    for o in research.opportunities:
        print(f"  • {o.description[:120]}")

    print(f"\nFull output → {out_file}")


if __name__ == "__main__":
    asyncio.run(main())
