"""Compare a run's ExecutiveReport against the golden sets and report metrics.

Usage (after a run produces ./out/<run_id>.json):

    python -m evals.run_eval --report ./out/<run_id>.json

TODO (Week 3):
- Load golden_competitors/seito_camera.json and golden_leads/seito_camera.json.
- Parse the ExecutiveReport JSON.
- Compute:
  - Competitor recall (with alias-aware matching)
  - Lead matches (with alias-aware matching)
  - Verification rate
- Emit PASS / STRONG PASS / FAIL per the thresholds defined in the JSON files.
- Write a diff report to ./out/eval_<run_id>.md.
"""
from __future__ import annotations
import json
import sys
from pathlib import Path
from typing import Any

import typer

app = typer.Typer()
ROOT = Path(__file__).parent


def _load_golden(filename: str) -> dict[str, Any]:
    with open(ROOT / filename) as f:
        return json.load(f)


def _normalize(name: str) -> str:
    return name.lower().replace(".", "").replace(" ", "").replace("-", "")


def _name_in_set(candidate: str, golden_entries: list[dict], key: str) -> bool:
    candidate_norm = _normalize(candidate)
    for entry in golden_entries:
        names = [entry[key]] + entry.get("aliases", [])
        if any(_normalize(n) == candidate_norm for n in names):
            return True
    return False


@app.command()
def main(report: Path = typer.Option(..., exists=True, readable=True)) -> None:
    """Compute recall against golden sets and print metrics."""
    report_data = json.loads(report.read_text())

    golden_comp = _load_golden("golden_competitors/seito_camera.json")
    golden_leads = _load_golden("golden_leads/seito_camera.json")

    # Competitor recall
    found_comps = [c["name"] for c in report_data.get("market_research", {}).get("competitors", [])]
    matched_comps = [c for c in found_comps if _name_in_set(c, golden_comp["competitors"], "canonical_name")]
    recall_comp = len(matched_comps) / len(golden_comp["competitors"]) if golden_comp["competitors"] else 0

    # Lead matches
    found_leads = [l["company_name"] for l in report_data.get("leads", {}).get("leads", [])]
    matched_leads = [l for l in found_leads if _name_in_set(l, golden_leads["leads"], "canonical_name")]

    # Verification rate
    verification = report_data.get("verification", {})
    total = verification.get("total_claims", 0)
    verified = verification.get("verified", 0)
    verif_rate = verified / total if total else 0

    # Print metrics
    typer.secho(f"\n=== EVAL for run {report_data.get('run_id', '?')} ===\n", fg=typer.colors.CYAN, bold=True)
    typer.echo(f"Competitors: recall = {recall_comp:.2%}  ({len(matched_comps)}/{len(golden_comp['competitors'])})")
    typer.echo(f"  matched: {matched_comps}")
    typer.echo(f"  missed:  {[c['canonical_name'] for c in golden_comp['competitors'] if not _name_in_set(c['canonical_name'], [{'canonical_name': m, 'aliases': []} for m in matched_comps], 'canonical_name')]}")
    typer.echo()
    typer.echo(f"Leads:       matched = {len(matched_leads)}/{len(golden_leads['leads'])}")
    typer.echo(f"  matched: {matched_leads}")
    typer.echo()
    typer.echo(f"Verification rate: {verif_rate:.2%}")

    # Pass/fail per thresholds
    comp_pass = recall_comp >= golden_comp["evaluation_thresholds"]["min_recall_for_pass"]
    comp_strong = recall_comp >= golden_comp["evaluation_thresholds"]["min_recall_for_strong_pass"]
    lead_pass = len(matched_leads) >= golden_leads["evaluation_thresholds"]["min_matches_for_pass"]
    lead_strong = len(matched_leads) >= golden_leads["evaluation_thresholds"]["min_matches_for_strong_pass"]
    verif_pass = verif_rate >= 0.80

    typer.echo()
    typer.secho(f"Competitor check: {'STRONG' if comp_strong else 'PASS' if comp_pass else 'FAIL'}",
                fg=typer.colors.GREEN if comp_pass else typer.colors.RED)
    typer.secho(f"Lead check:       {'STRONG' if lead_strong else 'PASS' if lead_pass else 'FAIL'}",
                fg=typer.colors.GREEN if lead_pass else typer.colors.RED)
    typer.secho(f"Verification:     {'PASS' if verif_pass else 'FAIL'}",
                fg=typer.colors.GREEN if verif_pass else typer.colors.RED)

    if not (comp_pass and lead_pass and verif_pass):
        sys.exit(1)


if __name__ == "__main__":
    app()
