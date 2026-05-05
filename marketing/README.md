# Seito Marketing AI

Hierarchical multi-agent marketing system. Five agents (Manager + Investigator + Strategist + Lead Hunter + Fact-Checker) run a full competitive-research → strategy → lead-generation cycle autonomously, returning an ExecutiveReport for human review.

Client zero: **Seito Camera** (cinema equipment rental, Barcelona). The system is designed to generalize to other SMBs in Phase 3.

> **Read the architecture doc before coding.** The full spec is in `../ARQUITECTURA_TECNICA.md` (Catalan). It contains the Pydantic schemas, full agent system prompts, orchestration state machine, error handling, and roadmap. Every file in this repo implements something described there.

---

## Prerequisites

- Python 3.12+
- Docker (for Postgres + pgvector)
- API keys: Anthropic, Exa, Brave

## Setup

```bash
# 1. Clone and install
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# 2. Configure
cp .env.example .env
# edit .env to add API keys

# 3. Start Postgres
docker compose up -d

# 4. Run migrations
alembic upgrade head

# 5. Smoke test
pytest tests/unit

# 6. Run the system for Seito Camera
seito run examples/seito_camera.json
```

## Project layout

```
src/
├── agents/          One module per agent. Inherit from agents.base.Agent.
├── prompts/         Markdown system prompts, loaded at runtime.
├── schemas/         Pydantic models — the contracts between agents.
├── tools/           Web search, fetch, scrape, LinkedIn, memory, validators.
├── memory/          SQLAlchemy models and repository.
├── orchestration/   State machine, budget, checkpoints, validators.
├── fact_checker/    Claim extraction.
└── observability/   Structlog, tracing.
evals/               Golden datasets and run_eval.py.
scripts/             Replay, seed.
```

## Roadmap (Phase 1 — 2-3 weeks)

See `../ARQUITECTURA_TECNICA.md` §16. Acceptance criteria:
- A single `seito run` completes in <5 min.
- Report has ≥4 competitors with sources, ≥3 angles considered, ≥6 verified leads.
- Cost <3 € per run.
- `verification_rate ≥ 0.85`.
- 0 invented companies or contacts.

## Running evals

```bash
python -m evals.run_eval
```

Compares the system's output against `evals/golden_competitors/seito_camera.json` and `evals/golden_leads/seito_camera.json`. See `evals/README.md`.

## Current status

- [x] Architecture spec (v1.1)
- [x] Eval datasets curated (5 competitors, 11 leads)
- [x] Investigator methodology validated via manual dry-run (5/5 recall on golden competitors)
- [ ] Code implementation — Week 1 starts here

## License

Private / internal to Seito Camera during Phase 1.
