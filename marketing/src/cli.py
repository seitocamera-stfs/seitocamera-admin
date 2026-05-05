"""CLI entrypoint.

Phase 1 commands:
- `seito investigate <business.json>` — run only the Investigator agent and dump MarketResearch.
- `seito run <business.json>` — stub for full workflow (not yet implemented).
- `seito verify-keys` — smoke test for API keys.
"""
from __future__ import annotations
import asyncio
import json
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import typer
from rich.console import Console

from .schemas.business import BusinessContext
from .schemas.research import MarketResearch
from .schemas.strategy import CampaignStrategy
from .schemas.briefs import ResearchBrief, StrategyBrief, LeadBrief
from .orchestration.budget import Budget, BudgetTracker
from .agents.investigator import Investigator
from .agents.strategist import Strategist
from .agents.lead_hunter import LeadHunter
from .settings import settings

app = typer.Typer(help="Seito Marketing AI — multi-agent marketing system")
console = Console()


@app.command()
def investigate(
    business_file: Path = typer.Argument(..., exists=True, readable=True),
    depth: int = typer.Option(3, min=1, max=5),
    max_competitors: int = typer.Option(5, min=3, max=8),
    output: Path = typer.Option(Path("./out"), help="Output directory"),
) -> None:
    """Run the Investigator agent and save MarketResearch JSON."""
    ctx = BusinessContext.model_validate(json.loads(business_file.read_text()))
    console.print(f"[bold green]Loaded[/] BusinessContext for [cyan]{ctx.name}[/]")

    brief = ResearchBrief(business=ctx, depth=depth, max_competitors=max_competitors)
    budget = BudgetTracker(
        Budget(
            max_usd=settings.max_usd_per_run,
            max_tokens=settings.max_tokens_per_run,
            max_tool_calls=settings.max_tool_calls_per_run,
        )
    )

    agent = Investigator(budget=budget)
    console.print(f"[yellow]Running Investigator[/] (model={agent.model}). This may take 1-2 min...")

    result = asyncio.run(agent.run(brief))

    # Save output
    output.mkdir(exist_ok=True)
    run_id = uuid4().hex[:12]
    out_file = output / f"investigator_{run_id}.json"
    out_file.write_text(result.model_dump_json(indent=2))

    console.print()
    console.print(f"[bold green]Done.[/] {len(result.competitors)} competitors, "
                  f"{len(result.opportunities)} opportunities.")
    console.print(f"Cost: [cyan]{budget.spent_usd:.4f} $[/] ({budget.spent_tokens} tokens, {budget.tool_calls} tool calls)")
    console.print(f"Output: [cyan]{out_file}[/]")


@app.command()
def strategize(
    business_file: Path = typer.Argument(..., exists=True, readable=True),
    research_file: Path = typer.Argument(..., exists=True, readable=True, help="Path to MarketResearch JSON from a prior `investigate` run"),
    budget_tier_hint: str | None = typer.Option(None, help="Hint to the Strategist: lean/moderate/aggressive"),
    output: Path = typer.Option(Path("./out"), help="Output directory"),
) -> None:
    """Run the Strategist agent given a prior MarketResearch. Produces a CampaignStrategy JSON."""
    ctx = BusinessContext.model_validate(json.loads(business_file.read_text()))
    research = MarketResearch.model_validate(json.loads(research_file.read_text()))
    console.print(f"[bold green]Loaded[/] business=[cyan]{ctx.name}[/] research=[cyan]{research_file.name}[/]")

    brief = StrategyBrief(business=ctx, research=research, budget_tier_hint=budget_tier_hint)
    budget = BudgetTracker(
        Budget(
            max_usd=settings.max_usd_per_run,
            max_tokens=settings.max_tokens_per_run,
            max_tool_calls=settings.max_tool_calls_per_run,
        )
    )

    agent = Strategist(budget=budget)
    console.print(f"[yellow]Running Strategist[/] (model={agent.model}). ~1 min...")

    result = asyncio.run(agent.run(brief))

    output.mkdir(exist_ok=True)
    run_id = uuid4().hex[:12]
    out_file = output / f"strategist_{run_id}.json"
    out_file.write_text(result.model_dump_json(indent=2))

    console.print()
    console.print(f"[bold green]Done.[/] {len(result.considered_angles)} angles considered, "
                  f"chosen: [cyan]{result.chosen_angle.label}[/]")
    console.print(f"Key message: [italic]{result.key_message}[/]")
    console.print(f"Channels: {', '.join(c.channel for c in result.channels)}")
    console.print(f"Cost: [cyan]{budget.spent_usd:.4f} $[/] ({budget.spent_tokens} tokens, {budget.tool_calls} tool calls)")
    console.print(f"Output: [cyan]{out_file}[/]")


@app.command()
def hunt(
    business_file: Path = typer.Argument(..., exists=True, readable=True),
    research_file: Path = typer.Argument(..., exists=True, readable=True),
    strategy_file: Path = typer.Argument(..., exists=True, readable=True),
    target_count: int = typer.Option(10, min=1, max=15),
    min_fit_score: int = typer.Option(6, min=1, max=10),
    output: Path = typer.Option(Path("./out"), help="Output directory"),
) -> None:
    """Run the Lead Hunter agent. Produces a LeadList JSON with verified prospects."""
    ctx = BusinessContext.model_validate(json.loads(business_file.read_text()))
    research = MarketResearch.model_validate(json.loads(research_file.read_text()))
    strategy = CampaignStrategy.model_validate(json.loads(strategy_file.read_text()))
    console.print(f"[bold green]Loaded[/] business=[cyan]{ctx.name}[/] strategy=[cyan]{strategy.chosen_angle.label}[/]")

    brief = LeadBrief(
        business=ctx, strategy=strategy, target_count=target_count, min_fit_score=min_fit_score
    )
    budget = BudgetTracker(
        Budget(
            max_usd=settings.max_usd_per_run,
            max_tokens=settings.max_tokens_per_run,
            max_tool_calls=settings.max_tool_calls_per_run,
        )
    )

    agent = LeadHunter(budget=budget)
    console.print(f"[yellow]Running Lead Hunter[/] (model={agent.model}). ~2-3 min...")

    result = asyncio.run(agent.run(brief))

    output.mkdir(exist_ok=True)
    run_id = uuid4().hex[:12]
    out_file = output / f"leads_{run_id}.json"
    out_file.write_text(result.model_dump_json(indent=2))

    console.print()
    console.print(f"[bold green]Done.[/] {len(result.leads)} leads, {result.rejected_candidates} rejected.")
    console.print()
    for i, lead in enumerate(result.leads, 1):
        console.print(f"  {i}. [cyan]{lead.company_name}[/] (fit={lead.fit_score}/10) — {lead.website}")
    console.print()
    console.print(f"Cost: [cyan]{budget.spent_usd:.4f} $[/] ({budget.spent_tokens} tokens, {budget.tool_calls} tool calls)")
    console.print(f"Output: [cyan]{out_file}[/]")


@app.command()
def run(
    business_file: Path = typer.Argument(..., exists=True, readable=True),
    autonomous: bool = typer.Option(False, help="Skip human-in-the-loop checkpoints"),
) -> None:
    """Run the full workflow. TODO: Week 3."""
    console.print("[yellow]Full workflow not yet implemented. Use `investigate` + `strategize` + `hunt` for now.[/]")


@app.command(name="verify-keys")
def verify_keys_cmd() -> None:
    """Smoke test: check all API keys are configured and working."""
    import subprocess
    import sys
    script = Path(__file__).parent.parent / "scripts" / "verify_keys.py"
    sys.exit(subprocess.call([sys.executable, str(script)]))


if __name__ == "__main__":
    app()
