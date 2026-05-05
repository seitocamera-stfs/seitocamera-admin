# AI Marketing Agency — Arquitectura Tècnica

**Projecte:** Sistema multi-agent jeràrquic per a generació autònoma de campanyes de màrqueting i leads
**Client zero:** Seito Camera (lloguer de material cinematogràfic, Barcelona)
**Autor:** Claude (arquitecte) — revisat amb Seito
**Data:** 2026-04-21
**Estat:** Spec v1.1 — llest per a implementació de la Fase 1 (prototip)

**Decisions tancades (v1.1):**
- Fase 1: **tots els agents amb Sonnet 4.6** (incloent el Manager). El Manager passarà a Opus quan la lògica d'orquestració se sofistiqui (revisar en Fase 2).
- **Multi-llengua obligatori des del dia 1**: català, castellà, anglès. Els outputs s'emeten en l'idioma definit a `BusinessContext.language`. Els prompts dels agents són en anglès (llengua tècnica); els agents reben instrucció explícita sobre l'idioma de sortida.
- **Eval dataset**: Seito proporciona manualment 5 competidors coneguts i 5 productores ideals (vegeu §15.3).

> Aquest document és la referència canònica per al desenvolupador que construeixi el sistema. Conté decisions arquitectòniques amb raonament, schemes Pydantic complets, system prompts íntegres per a cada agent, especificació d'eines, gestió d'errors, cost control, i estructura de projecte. Tot el codi és Python 3.12. La llengua de treball del projecte és el català, però el codi, schemes i noms d'identificadors es mantenen en anglès per convenció.

---

## Índex

1. Principis de disseny
2. Visió general del sistema
3. Stack tecnològic
4. Schemes Pydantic (contractes de dades)
5. System prompts dels agents
6. Orquestració i workflow
7. Capa de memòria
8. Eines externes (tool use)
9. Capa de validació (Fact-Checker)
10. Gestió d'errors i degradació
11. Cost control i rate limiting
12. Observabilitat i traçabilitat
13. Human-in-the-loop
14. Estructura del projecte
15. Testing i avaluació
16. Roadmap d'implementació (Fase 1)
17. Apèndix A — Exemples end-to-end
18. Apèndix B — Checklist de seguretat i GDPR

---

## 1. Principis de disseny

Aquestes decisions són vinculants. Si el sistema evoluciona de manera que les contradiu, calen revisar-les explícitament.

**P1 — Cap afirmació factual sense font.** Tot competidor, preu, contacte o empresa que aparegui en un output d'agent ha de tenir un camp `source_url` i `verified_at`. Els schemes Pydantic ho fan obligatori; sense font, la validació falla.

**P2 — Els agents no conversen lliurement.** Tota comunicació entre agents passa per missatges tipats (Pydantic). Res de string parsing. Si un schema no encaixa, es reintenta amb feedback estructurat.

**P3 — El Manager no fa feina d'especialista.** Només orquestra, delega, valida i consolida. Si et trobes afegint lògica de cerca o redacció al Manager, ho estàs fent malament.

**P4 — Hi ha un cap dur de cost.** Cada execució té un pressupost (tokens i diners). Quan s'apropa al límit, el sistema degrada amb gràcia i entrega el que té, mai es pertorba en silenci.

**P5 — El Director pot intervenir en qualsevol checkpoint.** El workflow té 3 punts d'aprovació opcional (post-recerca, post-estratègia, pre-entrega). En mode `autonomous=False`, el sistema para i espera. En mode `autonomous=True`, els omet però deixa traça.

**P6 — La memòria és consultada, no imposada.** Els agents llegeixen memòria com a context, no com a instruccions. Si un precedent contradiu el brief actual, guanya el brief.

**P7 — Fallar ràpid i visible.** Errors d'API, schemes invàlids, cites que no resolen → s'escriuen al log i es propaguen. Res de `try/except: pass`.

**P8 — Multi-llengua nativa, no traducció a posteriori.** Els agents reben l'idioma objectiu (`BusinessContext.language` ∈ {`ca`, `es`, `en`}) com a paràmetre i generen directament en aquest idioma. Les cerques web s'adapten a l'idioma quan té sentit (ex: "lloguer càmeres Barcelona" vs "camera rental Barcelona"). Els camps interns (claus JSON, enums, logs) són sempre en anglès. Mai es fa traducció automàtica d'un output ja generat — si cal canviar d'idioma, es regenera.

---

## 2. Visió general del sistema

### Diagrama de components

```
                    ┌──────────────────────────┐
                    │   Director (humà)        │
                    │   CLI / Dashboard web    │
                    └─────────────┬────────────┘
                                  │ BusinessContext
                                  ▼
                    ┌──────────────────────────┐
                    │   Manager (Opus)         │
                    │   orchestrator           │
                    └──┬──────────┬─────────┬──┘
                       │          │         │
              ResearchBrief  CampaignBrief  LeadBrief
                       │          │         │
                       ▼          ▼         ▼
         ┌─────────────────┐ ┌──────────┐ ┌──────────────┐
         │ Investigator    │ │Strategist│ │ Lead Hunter  │
         │ (Sonnet, T=0.2) │ │(T=0.7)   │ │ (T=0.2)      │
         └────────┬────────┘ └────┬─────┘ └──────┬───────┘
                  │               │              │
          MarketResearch   CampaignStrategy   LeadList
                  └───────────────┼──────────────┘
                                  ▼
                    ┌──────────────────────────┐
                    │ Fact-Checker (Sonnet)    │
                    │ verifies all claims      │
                    └─────────────┬────────────┘
                                  │ VerificationReport
                                  ▼
                    ┌──────────────────────────┐
                    │ Manager consolidates     │
                    │ → ExecutiveReport        │
                    └─────────────┬────────────┘
                                  ▼
                           Director review
```

### Models d'LLM per agent

| Agent          | Model                    | Temperature | Max tokens out | Justificació                                                    |
|----------------|--------------------------|-------------|----------------|-----------------------------------------------------------------|
| Manager        | claude-sonnet-4-6        | 0.2         | 4000           | Fase 1: Sonnet per contenir cost. Revisar upgrade a Opus en F2  |
| Investigator   | claude-sonnet-4-6        | 0.2         | 8000           | Recerca factual, precisió sobre creativitat                     |
| Strategist     | claude-sonnet-4-6        | 0.7         | 4000           | Necessita divergència per no caure a la mitjana                 |
| Lead Hunter    | claude-sonnet-4-6        | 0.2         | 6000           | Identificació factual, outputs estructurats                     |
| Fact-Checker   | claude-sonnet-4-6        | 0.0         | 4000           | Determinista, audita outputs d'altres                           |

> **Nota sobre el model del Manager:** durant la Fase 1 fem Sonnet per tot per simplicitat operativa i cost. Això redueix el cost estimat per run en ~30% (vegeu §11). Si en els primers 10 runs reals el Manager mostra dificultats per arbitrar conflictes entre especialistes o per sintetitzar informes de qualitat, es promou a Opus només per a ell. La configuració és via variable d'entorn `MODEL_MANAGER`, així que el canvi és trivial.

### Decisions arquitectòniques clau (ADRs)

**ADR-001 — Framework: Claude Agent SDK.** Descartat LangGraph (sobreenginyeria per al cas), CrewAI (massa magic per debugar prompts), orquestració casolana (es reinventaria el mateix). Revisar si en 6 mesos el workflow té més de 5 branches condicionals; llavors valorar LangGraph.

**ADR-002 — Python, no TypeScript.** Pydantic v2, ecosistema de dades (pandas, httpx, Playwright), millor suport per scraping i batch. El futur dashboard web pot ser TS/Next.js separadament.

**ADR-003 — Postgres + pgvector per a memòria.** Una sola base de dades per a dades estructurades i semàntiques. Evita complicitat operativa de Qdrant/Chroma + Postgres. Revisar si el volum d'embeddings passa de 1M.

**ADR-004 — Exa + Brave per a cerca.** Exa per recerca semàntica de mercat i leads, Brave per cerques generals i verificació. Descartat SerpAPI per preu i TOS restrictiu. Google Custom Search per ús puntual.

**ADR-005 — Playwright, no BeautifulSoup sol.** Molts sites de competidors carreguen contingut via JS. Playwright headless permet scraping controlat amb rate limiting i respecte a robots.txt. Cal un `user-agent` identificable i límit estricte de requests per domini.

---

## 3. Stack tecnològic

### Runtime i dependències

```toml
# pyproject.toml (extracte)
[project]
name = "seito-marketing-ai"
version = "0.1.0"
requires-python = ">=3.12"

dependencies = [
    "anthropic>=0.40.0",             # Claude API client
    "claude-agent-sdk>=0.5.0",       # agent orchestration primitives
    "pydantic>=2.7.0",
    "pydantic-settings>=2.2.0",
    "sqlalchemy>=2.0.30",
    "alembic>=1.13.0",
    "psycopg[binary]>=3.1.18",
    "pgvector>=0.3.0",
    "httpx>=0.27.0",
    "tenacity>=8.3.0",
    "playwright>=1.44.0",
    "exa-py>=1.0.9",
    "structlog>=24.1.0",
    "rich>=13.7.0",                   # CLI presentation
    "typer>=0.12.0",                  # CLI framework
    "fastapi>=0.110.0",               # per a la Fase 2
    "uvicorn[standard]>=0.29.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.2.0",
    "pytest-asyncio>=0.23.0",
    "pytest-recording>=0.13.0",       # VCR-like per gravar respostes d'LLM en tests
    "ruff>=0.4.0",
    "mypy>=1.10.0",
]
```

### Variables d'entorn

```bash
# .env.example
ANTHROPIC_API_KEY=sk-ant-...
EXA_API_KEY=...
BRAVE_SEARCH_API_KEY=...
DATABASE_URL=postgresql+psycopg://seito:pass@localhost:5432/marketing
LOG_LEVEL=INFO

# budget hard caps (per run)
MAX_USD_PER_RUN=5.00
MAX_TOKENS_PER_RUN=500000
MAX_TOOL_CALLS_PER_RUN=150

# feature flags
AUTONOMOUS_MODE=false        # si true, salta checkpoints human-in-the-loop
ENABLE_SCRAPING=true
SCRAPING_RPS_PER_DOMAIN=0.5  # requests per second per domain
```

### Infraestructura mínima (Fase 1)

Localhost per al prototip. Postgres via Docker, res més.

```yaml
# docker-compose.yml
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: seito
      POSTGRES_PASSWORD: pass
      POSTGRES_DB: marketing
    ports: ["5432:5432"]
    volumes: ["./data/pg:/var/lib/postgresql/data"]
```

---

## 4. Schemes Pydantic (contractes de dades)

Tots els intercanvis entre agents es fan amb aquests models. Si un LLM retorna JSON que no valida, el sistema reintenta amb feedback de l'error (màxim 3 intents).

### 4.1 `BusinessContext` — Input del Director

```python
# src/schemas/business.py
from __future__ import annotations
from pydantic import BaseModel, Field, HttpUrl
from typing import Literal

class BusinessContext(BaseModel):
    """What the Director tells the Manager about the business."""
    name: str = Field(..., description="Business name, e.g. 'Seito Camera'")
    description: str = Field(..., min_length=30, description="Plain-language description of what the business sells")
    vertical: str = Field(..., description="Industry vertical, e.g. 'audiovisual equipment rental'")
    location: str = Field(..., description="Primary geographic market, e.g. 'Barcelona'")
    target_customers: list[str] = Field(..., min_length=1, description="Buyer personas")
    unique_strengths: list[str] = Field(default_factory=list, description="What the business believes it does better than competitors")
    known_competitors: list[str] = Field(default_factory=list, description="Competitors the Director already knows — seed for the Investigator")
    language: Literal["ca", "es", "en"] = "ca"
    website: HttpUrl | None = None
    goals: list[str] = Field(default_factory=list, description="Business goals, e.g. 'more high-end productions as clients'")
    excluded_segments: list[str] = Field(default_factory=list, description="Segments to NOT target, e.g. 'weekend amateur videographers'")
```

### 4.2 `MarketResearch` — Output de l'Investigador

```python
# src/schemas/research.py
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, Field, HttpUrl, field_validator

class Source(BaseModel):
    """A verifiable source for a factual claim."""
    url: HttpUrl
    title: str | None = None
    retrieved_at: datetime
    excerpt: str | None = Field(None, description="Short quote supporting the claim (<300 chars)")

    @field_validator("excerpt")
    @classmethod
    def excerpt_length(cls, v: str | None) -> str | None:
        if v and len(v) > 300:
            raise ValueError("excerpt must be <=300 chars")
        return v

class PriceRange(BaseModel):
    low_eur: float | None = None
    high_eur: float | None = None
    unit: str = Field(..., description="e.g. 'per day', 'per week', 'per production'")
    notes: str | None = None

class Competitor(BaseModel):
    name: str
    website: HttpUrl | None = None
    positioning: str = Field(..., description="One-sentence positioning as observed")
    price_range: PriceRange | None = None
    primary_channels: list[str] = Field(default_factory=list, description="Channels they use: instagram, linkedin, word-of-mouth, SEO, etc.")
    content_style: str | None = None
    observed_strengths: list[str] = Field(default_factory=list)
    observed_weaknesses: list[str] = Field(default_factory=list)
    sources: list[Source] = Field(..., min_length=1, description="MUST have at least one source")

class MarketOpportunity(BaseModel):
    description: str
    rationale: str = Field(..., description="Why this is an opportunity, grounded in observed evidence")
    evidence: list[Source] = Field(..., min_length=1)

class MarketResearch(BaseModel):
    business: str = Field(..., description="Echo of business name for traceability")
    vertical: str
    geography: str
    competitors: list[Competitor] = Field(..., min_length=3, max_length=8)
    price_summary: str = Field(..., description="Synthesis of competitor pricing in prose")
    channel_summary: str = Field(..., description="Synthesis of which channels competitors use and how")
    opportunities: list[MarketOpportunity] = Field(..., min_length=2)
    risks: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list, description="Things the Investigator could not verify and flagged for human review")
    generated_at: datetime
    tokens_used: int = Field(..., ge=0)
```

### 4.3 `CampaignStrategy` — Output de l'Estratega

```python
# src/schemas/strategy.py
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, Field
from typing import Literal

class Angle(BaseModel):
    """One strategic angle the Strategist considered."""
    label: str = Field(..., description="Short label, e.g. 'Technical authority'")
    pitch: str = Field(..., description="2-3 sentence description of the angle")
    differentiation_vs_competitors: str = Field(..., description="How this angle is NOT already claimed by competitors cited in the research")
    estimated_fit: Literal["low", "medium", "high"]
    rationale: str

class ChannelPlan(BaseModel):
    channel: str = Field(..., description="e.g. 'LinkedIn', 'Vimeo', 'direct outreach'")
    why: str
    format: str = Field(..., description="What content format fits this channel, e.g. 'behind-the-scenes video <90s'")
    cadence: str = Field(..., description="e.g. '2 posts/week for 6 weeks'")
    primary_kpi: str

class CampaignStrategy(BaseModel):
    business: str
    considered_angles: list[Angle] = Field(..., min_length=3, description="The Strategist MUST generate at least 3 angles before choosing")
    chosen_angle: Angle
    key_message: str = Field(..., description="One sentence. The thing a prospect should remember.")
    target_segments: list[str] = Field(..., min_length=1)
    channels: list[ChannelPlan] = Field(..., min_length=1, max_length=4)
    timing: str = Field(..., description="When to run and why, e.g. 'August-September, before high season'")
    budget_tier: Literal["lean", "moderate", "aggressive"]
    success_metrics: list[str] = Field(..., min_length=2)
    creativity_notes: str = Field(..., description="What the Strategist explicitly did to avoid mediocrity — required non-empty")
    generated_at: datetime
    tokens_used: int = Field(..., ge=0)
```

### 4.4 `LeadList` — Output del Caçador

```python
# src/schemas/leads.py
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, Field, EmailStr, HttpUrl

class Contact(BaseModel):
    name: str | None = None
    role: str | None = None
    email: EmailStr | None = None
    linkedin: HttpUrl | None = None
    phone: str | None = None
    source: HttpUrl = Field(..., description="Where this contact info was observed — REQUIRED")

class Lead(BaseModel):
    company_name: str
    website: HttpUrl
    description: str
    location: str
    size_hint: str | None = Field(None, description="e.g. '10-50 employees' if observable")
    why_good_fit: str = Field(..., description="Grounded in the campaign strategy — why this lead matches")
    fit_score: int = Field(..., ge=1, le=10)
    evidence: list[HttpUrl] = Field(..., min_length=1, description="URLs that support why_good_fit")
    contacts: list[Contact] = Field(default_factory=list)
    suggested_outreach: str = Field(..., description="First-touch approach tailored to this lead")
    validation_checks: dict[str, bool] = Field(..., description="Must include: website_reachable, business_active, fits_segment, contact_verifiable, not_excluded")

class LeadList(BaseModel):
    strategy_reference: str = Field(..., description="Summary of the strategy these leads were hunted for")
    leads: list[Lead] = Field(..., min_length=1, max_length=15)
    rejected_candidates: int = Field(..., ge=0, description="How many candidates were considered and rejected")
    rejection_reasons: dict[str, int] = Field(default_factory=dict, description="Histogram of rejection reasons")
    generated_at: datetime
    tokens_used: int = Field(..., ge=0)
```

### 4.5 `VerificationReport` — Output del Fact-Checker

```python
# src/schemas/verification.py
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, Field
from typing import Literal

class ClaimVerification(BaseModel):
    claim: str = Field(..., description="The exact claim being checked")
    agent_source: Literal["investigator", "strategist", "lead_hunter"]
    status: Literal["verified", "unverifiable", "contradicted"]
    evidence_urls: list[str] = Field(default_factory=list)
    notes: str | None = None

class VerificationReport(BaseModel):
    total_claims: int
    verified: int
    unverifiable: int
    contradicted: int
    claims: list[ClaimVerification]
    blocking_issues: list[str] = Field(default_factory=list, description="Issues severe enough to block delivery")
    generated_at: datetime
    tokens_used: int = Field(..., ge=0)

    @property
    def verification_rate(self) -> float:
        return self.verified / self.total_claims if self.total_claims else 0.0
```

### 4.6 `ExecutiveReport` — Output final del Manager

```python
# src/schemas/report.py
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, Field
from .research import MarketResearch
from .strategy import CampaignStrategy
from .leads import LeadList
from .verification import VerificationReport

class CostBreakdown(BaseModel):
    total_usd: float
    total_tokens: int
    per_agent_usd: dict[str, float]
    tool_calls: int
    web_searches: int

class ExecutiveReport(BaseModel):
    business: str
    run_id: str
    executive_summary: str = Field(..., description="3-5 sentences a busy founder can read in 30 seconds")
    market_research: MarketResearch
    strategy: CampaignStrategy
    leads: LeadList
    verification: VerificationReport
    flagged_items: list[str] = Field(default_factory=list, description="Anything the Manager wants the Director to double-check")
    suggested_next_steps: list[str] = Field(..., min_length=1, max_length=5)
    cost: CostBreakdown
    generated_at: datetime
```

### 4.7 Briefs intermedis (Manager → agents)

```python
# src/schemas/briefs.py
from pydantic import BaseModel, Field
from .research import MarketResearch
from .strategy import CampaignStrategy
from .business import BusinessContext

class ResearchBrief(BaseModel):
    business: BusinessContext
    depth: int = Field(3, ge=1, le=5, description="1=quick scan, 5=deep investigation")
    focus_competitors: list[str] = Field(default_factory=list)
    max_competitors: int = 5

class StrategyBrief(BaseModel):
    business: BusinessContext
    research: MarketResearch
    require_min_angles: int = 3
    budget_tier_hint: str | None = None

class LeadBrief(BaseModel):
    business: BusinessContext
    strategy: CampaignStrategy
    target_count: int = Field(10, ge=1, le=15)
    min_fit_score: int = 6
```

---

## 5. System prompts dels agents

Cada prompt segueix la mateixa estructura de quatre seccions: **ROLE**, **CAPABILITIES**, **ANTI-PATTERNS**, **OUTPUT**. Això no és decoratiu — és el que evita la deriva de rol.

Els prompts es guarden a `src/prompts/` com a fitxers Markdown separats, versionats amb el codi. S'injecten via `PromptLoader.load("researcher")`.

### 5.1 Manager (`src/prompts/manager.md`)

```markdown
# ROLE
You are the Manager of an AI marketing agency. Your single job is to orchestrate
the work of four specialist agents (Investigator, Strategist, Lead Hunter,
Fact-Checker) and consolidate their outputs into an ExecutiveReport for the
human Director.

You are NOT a researcher, strategist, or lead hunter. You do not search the web,
propose campaigns, or identify companies. Those are your specialists' jobs.

You ARE accountable for: correctly scoping each delegation, catching when a
specialist has produced something weak, running the Fact-Checker before
delivery, and writing the final executive summary.

# CAPABILITIES
- Delegate to subagents via the Task tool (one at a time, sequentially)
- Read business memory from the memory subsystem (past campaigns, what worked)
- Write to memory after the run completes
- Produce the final ExecutiveReport JSON

# ANTI-PATTERNS (do NOT do these)
- Do NOT do the specialists' work yourself, even if it seems faster.
- Do NOT skip the Fact-Checker step, ever, even under time pressure.
- Do NOT rewrite a specialist's output to sound better — if it is weak, send it
  back with specific feedback (max 1 revision round per specialist).
- Do NOT invent competitors, leads, or numbers in your executive summary. Every
  figure must trace to a specialist's verified output.
- Do NOT continue if the cost budget is exceeded. Call `abort_with_partial_results`.

# WORKFLOW
1. Receive a BusinessContext.
2. Query memory for past runs on the same business or similar verticals.
3. Delegate to Investigator with a ResearchBrief. Wait for MarketResearch.
4. Inspect: does it have ≥3 competitors with sources? If not, send back with
   explicit feedback (one revision allowed).
5. Checkpoint-1: if autonomous=false, present research to Director for approval.
6. Delegate to Strategist with StrategyBrief. Wait for CampaignStrategy.
7. Inspect: does it have ≥3 considered_angles and a non-empty creativity_notes?
   If not, one revision allowed.
8. Checkpoint-2: if autonomous=false, present strategy to Director for approval.
9. Delegate to Lead Hunter with LeadBrief. Wait for LeadList.
10. Inspect: do all leads pass their validation_checks? Reject leads that don't.
11. Delegate to Fact-Checker with the full bundle. Wait for VerificationReport.
12. If VerificationReport.blocking_issues is non-empty, STOP and flag to Director.
13. Checkpoint-3: present ExecutiveReport.
14. On Director approval, persist to memory.

# OUTPUT
Your final output is an ExecutiveReport (JSON matching the schema). Your
executive_summary field must be 3-5 sentences, in {{business.language}},
readable by someone who will not read the rest of the report.
```

### 5.2 Investigator (`src/prompts/investigator.md`)

```markdown
# ROLE
You are a market research analyst. Given a business and its market, you
identify real competitors, their pricing, channels, and positioning, based
ONLY on evidence you can verify via web search and page fetches.

# CAPABILITIES
- web_search(query, num_results) — Exa and Brave
- fetch_url(url) — Playwright-backed, respects robots.txt
- scrape_structured(url, schema) — extract structured data from a page

# ANTI-PATTERNS
- Do NOT invent competitors. If you cannot find at least 3 with sources, return
  fewer and flag it in open_questions — do NOT pad the list.
- Do NOT invent pricing. If a competitor does not publish prices, set
  price_range to null and note it.
- Do NOT rely on general knowledge (what you "know" about the industry). Every
  factual claim needs a URL retrieved within this run.
- Do NOT quote more than 300 characters from any source (fair use).
- Do NOT include competitors that the business itself listed in
  `excluded_segments` or that are clearly out of scope.

# METHODOLOGY
1. Start with 2-3 broad queries to map the landscape
   ("[vertical] [location]", "[vertical] companies [location]",
    "[product category] rental [location]").
2. For each candidate, visit their website and look for: services, pricing,
   positioning, contact, blog, social links.
3. Cross-reference: if a competitor appears in 2+ independent sources
   (not their own site), confidence is higher.
4. For pricing: prefer explicit published prices. If only ranges are
   implied, say so.
5. For channels: check the site footer, blog, explicit social CTAs. Do NOT
   infer channels from absence of evidence.
6. For opportunities: look for what competitors are NOT doing consistently,
   not just what one competitor fails at.

# OUTPUT
Return a MarketResearch JSON object (schema provided). Every Competitor must
have `sources` with ≥1 entry. Every MarketOpportunity must have `evidence` with
≥1 entry. If you could not verify something the brief asked about, put it in
`open_questions` instead of guessing.
```

### 5.3 Strategist (`src/prompts/strategist.md`)

```markdown
# ROLE
You are a senior campaign strategist. Given market research and a business
context, you design a campaign angle that is specific, differentiated, and
grounded in the business's real strengths.

You are NOT a researcher (don't re-search) and NOT a lead hunter (don't name
specific companies). You think about positioning, messaging, channels, timing.

# CAPABILITIES
- query_memory(past_campaigns) — learn from prior runs
- web_search(query) — LIMITED to 3 queries per run, only for validating a
  specific creative hypothesis (e.g. "is the angle I'm considering already
  trending?")

# ANTI-PATTERNS
- Do NOT default to "post more on LinkedIn" or other generic advice.
- Do NOT pick the most "safe" angle — pick the most differentiated, and
  justify it.
- Do NOT ignore the research. If competitors dominate a channel, your default
  is to find an under-served channel, not compete head-on (unless you
  explicitly argue for head-on with evidence).
- Do NOT propose >4 channels. Focus beats breadth.
- Do NOT omit considered_angles. You MUST show your work: at least 3 angles
  considered before choosing one.

# METHODOLOGY
1. Read the research carefully. What are competitors NOT doing?
2. Read the business's `unique_strengths`. What would be authentic for them to
   claim?
3. Generate 3 distinct angles. One should feel uncomfortable — that's often
   the most differentiated. The others can be safer.
4. For each angle, specify: differentiation, fit, rationale.
5. Choose one. Explicitly state in `creativity_notes` what you did to avoid
   the mean (e.g. "rejected the obvious 'best prices' angle because it would
   commoditize us alongside Competitor X").
6. Design 1-4 channels that match the chosen angle, not all channels.

# OUTPUT
Return a CampaignStrategy JSON. `creativity_notes` must be non-empty and
specific. `considered_angles` must contain ≥3 entries. `key_message` must be
one sentence, memorable, in the business's language.
```

### 5.4 Lead Hunter (`src/prompts/lead_hunter.md`)

```markdown
# ROLE
You are a lead research specialist. Given a campaign strategy and a target
audience description, you identify real companies that match the strategy
and are reachable.

# CAPABILITIES
- web_search(query)
- fetch_url(url)
- linkedin_company_lookup(name) — basic public data only, respects ToS
- email_pattern_guess(domain, name) — suggests likely email patterns; does NOT
  verify deliverability
- validate_lead(lead) — runs the 5 validation checks

# ANTI-PATTERNS
- Do NOT invent companies. Every company name must appear on a real website
  you fetched.
- Do NOT scrape LinkedIn pages beyond the public company overview. No people
  scraping, no emails harvested at scale. This is a GDPR-sensitive area.
- Do NOT include a lead unless it passes ≥3 of the 5 validation checks.
  Return fewer leads rather than pad with weak ones.
- Do NOT copy/paste the strategy's phrasing into every lead's suggested_outreach.
  Each outreach should reference something specific about the lead.
- Do NOT guess email addresses as if they were verified. If you propose an
  email pattern, mark source as the pattern reasoning, not as verified.

# METHODOLOGY
1. Derive 3-5 search queries from the target_segments and strategy.
2. For each candidate, open the website. Confirm: (a) business is active
   (recent news, posts, portfolio), (b) they fit the segment, (c) they are
   not in excluded_segments.
3. Score fit 1-10 based on how many strategy criteria the lead meets.
4. Pull contact info only from publicly listed sources (website contact page,
   public LinkedIn company page). Prefer role-based emails (info@, hello@)
   over personal ones unless explicitly listed.
5. Draft suggested_outreach that references something specific: a recent
   project they published, a tool they use, an award they won.
6. Log rejections with reasons in `rejection_reasons`.

# OUTPUT
Return a LeadList JSON. `leads` must be between 1 and `target_count`. Every
lead must have validation_checks populated. `rejected_candidates` must reflect
how many you actually considered (show your work).
```

### 5.5 Fact-Checker (`src/prompts/fact_checker.md`)

```markdown
# ROLE
You audit the outputs of the other three agents before delivery. Your job is
to catch hallucinations, unverifiable claims, and contradictions.

You are deterministic. You do NOT generate content. You do NOT "fix" things.
You report what you find.

# CAPABILITIES
- web_search(query)
- fetch_url(url)

# ANTI-PATTERNS
- Do NOT rewrite any content. Your output is only a VerificationReport.
- Do NOT mark a claim as "verified" unless you actually fetched a source that
  supports it within this run.
- Do NOT be lenient on high-impact claims (pricing, contact emails, company
  existence). Be willing to mark a whole output as blocked.

# METHODOLOGY
1. Extract all factual claims from the bundle (MarketResearch + CampaignStrategy
   + LeadList). Include: competitor names, prices, channels, company names,
   contact emails, statistics, any dated event.
2. For each claim, attempt to verify via the provided source (if given) or
   independent search.
3. Classify: verified / unverifiable / contradicted.
4. A verification_rate below 0.80 is a blocking issue. A contradicted claim
   in a lead's contact info is a blocking issue.
5. Report specifically. "Claim X is unverifiable because the cited URL
   returned 404" is useful; "some claims are iffy" is not.

# OUTPUT
Return a VerificationReport JSON. Include every claim you checked, not just
problems.
```

---

## 6. Orquestració i workflow

### 6.1 State machine

L'execució és una màquina d'estats explícita. Cada transició es registra.

```
        ┌─────────┐
        │  INIT   │
        └────┬────┘
             │ BusinessContext validated
             ▼
        ┌────────────────┐
        │ RESEARCH       │───┐ on failure → REVISE_RESEARCH (max 1)
        └────┬───────────┘   │
             │               └──→ RESEARCH (retry)
             ▼
        ┌────────────────┐
        │ CHECKPOINT_1   │   (skip if autonomous)
        └────┬───────────┘
             │ Director approved | autonomous
             ▼
        ┌────────────────┐
        │ STRATEGY       │───┐
        └────┬───────────┘   └──→ REVISE_STRATEGY → STRATEGY
             ▼
        ┌────────────────┐
        │ CHECKPOINT_2   │
        └────┬───────────┘
             ▼
        ┌────────────────┐
        │ LEADS          │
        └────┬───────────┘
             ▼
        ┌────────────────┐
        │ VERIFY         │
        └────┬───────────┘
             │ blocking_issues empty?
             ▼
        ┌────────────────┐
        │ CHECKPOINT_3   │
        └────┬───────────┘
             ▼
        ┌────────────────┐
        │ FINALIZE       │
        └────┬───────────┘
             ▼
        ┌────────────────┐
        │ PERSIST_MEMORY │
        └────┬───────────┘
             ▼
        ┌────────────────┐
        │ DONE           │
        └────────────────┘

Any state → ABORTED on: budget_exceeded | director_rejected | max_revisions_exceeded
```

### 6.2 Implementació de la màquina d'estats

```python
# src/orchestration/workflow.py
from enum import Enum
from dataclasses import dataclass, field
from datetime import datetime
from ..schemas.business import BusinessContext
from ..schemas.research import MarketResearch
from ..schemas.strategy import CampaignStrategy
from ..schemas.leads import LeadList
from ..schemas.verification import VerificationReport
from ..schemas.report import ExecutiveReport

class State(str, Enum):
    INIT = "init"
    RESEARCH = "research"
    CHECKPOINT_1 = "checkpoint_1"
    STRATEGY = "strategy"
    CHECKPOINT_2 = "checkpoint_2"
    LEADS = "leads"
    VERIFY = "verify"
    CHECKPOINT_3 = "checkpoint_3"
    FINALIZE = "finalize"
    PERSIST_MEMORY = "persist_memory"
    DONE = "done"
    ABORTED = "aborted"

@dataclass
class RunState:
    run_id: str
    business: BusinessContext
    autonomous: bool
    state: State = State.INIT
    research: MarketResearch | None = None
    strategy: CampaignStrategy | None = None
    leads: LeadList | None = None
    verification: VerificationReport | None = None
    report: ExecutiveReport | None = None
    abort_reason: str | None = None
    revisions: dict[str, int] = field(default_factory=dict)
    started_at: datetime = field(default_factory=datetime.utcnow)
```

### 6.3 Revision loop

Cada especialista té dret a UN reintent si el seu output no valida o és clarament dèbil.

```python
# pseudocode
async def run_with_revision(agent, brief, validator, max_revisions=1):
    attempt = 0
    feedback: str | None = None
    while attempt <= max_revisions:
        output = await agent.run(brief, feedback=feedback)
        verdict = validator(output)
        if verdict.ok:
            return output
        if attempt == max_revisions:
            raise WeakOutputError(verdict.reasons)
        feedback = verdict.feedback_for_agent()
        attempt += 1
```

El `validator` NO és un LLM — és codi Python que verifica invariants (schema vàlid, longituds mínimes, sources presents). Si cal judici qualitatiu, es delega al Fact-Checker més tard.

---

## 7. Capa de memòria

### 7.1 Esquema de base de dades

```sql
-- alembic migration v001
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE businesses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    vertical TEXT NOT NULL,
    location TEXT NOT NULL,
    context JSONB NOT NULL,            -- BusinessContext serialized
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(name)
);

CREATE TABLE runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES businesses(id),
    state TEXT NOT NULL,
    autonomous BOOLEAN NOT NULL,
    report JSONB,                      -- ExecutiveReport serialized, nullable until done
    cost_usd NUMERIC(10,4),
    tokens INT,
    started_at TIMESTAMPTZ DEFAULT now(),
    finished_at TIMESTAMPTZ
);

CREATE TABLE run_events (
    id BIGSERIAL PRIMARY KEY,
    run_id UUID REFERENCES runs(id),
    agent TEXT NOT NULL,               -- manager | investigator | strategist | lead_hunter | fact_checker
    event TEXT NOT NULL,               -- state_transition | llm_call | tool_call | error | checkpoint
    payload JSONB NOT NULL,
    ts TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX run_events_run_id_ts ON run_events (run_id, ts);

CREATE TABLE lead_outcomes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID REFERENCES runs(id),
    lead_snapshot JSONB NOT NULL,
    contacted BOOLEAN DEFAULT false,
    contacted_at TIMESTAMPTZ,
    response TEXT,                     -- positive | negative | no_response | converted
    response_at TIMESTAMPTZ,
    notes TEXT
);

-- semantic memory: campaign-level insights
CREATE TABLE insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID REFERENCES businesses(id),
    run_id UUID REFERENCES runs(id),
    text TEXT NOT NULL,                -- short insight, e.g. "Technical-authority angle converted at 2x rate"
    embedding VECTOR(1024),            -- Voyage embeddings
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX insights_embedding_ivfflat
    ON insights USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
```

### 7.2 Repository

```python
# src/memory/repository.py (interface)
class MemoryRepository:
    async def get_business(self, name: str) -> BusinessRow | None: ...
    async def upsert_business(self, ctx: BusinessContext) -> UUID: ...
    async def create_run(self, business_id: UUID, autonomous: bool) -> UUID: ...
    async def record_event(self, run_id: UUID, agent: str, event: str, payload: dict) -> None: ...
    async def finalize_run(self, run_id: UUID, report: ExecutiveReport, cost_usd: float, tokens: int) -> None: ...
    async def query_similar_insights(self, text: str, business_id: UUID | None, k: int = 5) -> list[InsightRow]: ...
    async def record_insight(self, run_id: UUID, business_id: UUID, text: str, tags: list[str]) -> None: ...
    async def record_lead_outcome(self, run_id: UUID, lead: Lead) -> UUID: ...
    async def update_lead_outcome(self, lead_outcome_id: UUID, response: str, notes: str) -> None: ...
```

### 7.3 Quan s'escriu a memòria

- **Al final d'un run exitós:** es persisteix el `ExecutiveReport` sencer, i el Manager genera 1-3 insights curts (ex: "La investigació sobre BCN va trigar 2 minuts; Exa va ser més útil que Brave per al vertical") que s'emmagatzemen amb embedding.
- **Quan el Director introdueix feedback:** si el Director modifica l'informe, el diff es guarda com a insight negatiu ("Manager proposava Angle X, Director el va canviar a Y perquè Z").
- **Quan es recull outcome d'un lead (mes següent):** es registra a `lead_outcomes`, i si hi ha patrons (3 leads convertits al mateix segment), es generen insights.

### 7.4 Quan es consulta

El Manager, al principi de cada run, crida `query_similar_insights(business.vertical + " " + business.location, business_id=same, k=5)` i injecta els resultats al seu context com a "Prior learnings".

L'Estratega fa el mateix amb una consulta més específica: `query_similar_insights(chosen_angle.label, business_id=same)` abans d'escriure `creativity_notes`.

---

## 8. Eines externes (tool use)

### 8.1 Contractes de les eines

Totes les eines expostes als agents implementen aquest protocol:

```python
# src/tools/base.py
from typing import Protocol, TypeVar, Generic
from pydantic import BaseModel

InputT = TypeVar("InputT", bound=BaseModel)
OutputT = TypeVar("OutputT", bound=BaseModel)

class Tool(Protocol, Generic[InputT, OutputT]):
    name: str
    description: str
    input_schema: type[InputT]
    output_schema: type[OutputT]

    async def execute(self, input: InputT, context: "ToolContext") -> OutputT: ...

class ToolContext(BaseModel):
    run_id: str
    agent: str
    budget: "BudgetTracker"
```

### 8.2 `web_search`

```python
# src/tools/web_search.py
class WebSearchInput(BaseModel):
    query: str
    num_results: int = Field(5, ge=1, le=20)
    provider: Literal["exa", "brave", "auto"] = "auto"

class WebSearchResult(BaseModel):
    url: HttpUrl
    title: str
    snippet: str
    published_at: datetime | None = None

class WebSearchOutput(BaseModel):
    query: str
    provider_used: str
    results: list[WebSearchResult]

class WebSearch:
    """Dual-provider web search. Exa for semantic, Brave for factual/recent.

    Routing:
    - provider="exa" or query contains "companies like" / "similar to" → Exa
    - provider="brave" or query contains specific entity names → Brave
    - "auto": start with Exa, fallback to Brave if <3 results
    """
    ...
```

### 8.3 `fetch_url`

Controlat. Respect a `robots.txt`. Headers identificables. Rate limit per domini.

```python
class FetchUrlInput(BaseModel):
    url: HttpUrl
    render_js: bool = True

class FetchUrlOutput(BaseModel):
    url: HttpUrl
    status: int
    content_type: str
    text: str            # cleaned, <50k chars
    title: str | None
    fetched_at: datetime
    truncated: bool
```

Regles:
- Si `robots.txt` ho prohibeix → retorna error sense fer la request.
- Rate limit: max `SCRAPING_RPS_PER_DOMAIN` requests per segon per domini.
- User-Agent: `SeitoMarketingBot/0.1 (+https://seitocamera.example/bot)`.
- Truncar text a 50k caràcters; si més, el camp `truncated=true` i l'agent pot demanar un chunk específic.

### 8.4 `scrape_structured`

Per extreure dades específiques amb schema. Internament usa Claude amb contextos curts sobre text ja obtingut amb `fetch_url` (evita scraping i LLM call en una sola eina, mantenint separació).

### 8.5 `linkedin_company_lookup`

**ATENCIÓ GDPR / ToS:** només dades públiques de company pages. Res d'scraping de perfils personals. Prioritzar l'API oficial de LinkedIn quan possible (requereix partnership); fins llavors, usar cerca web i pàgines públiques.

```python
class LinkedInCompanyInput(BaseModel):
    name: str
    location_hint: str | None = None

class LinkedInCompanyOutput(BaseModel):
    found: bool
    name: str | None
    url: HttpUrl | None
    description: str | None
    industry: str | None
    size_hint: str | None
    followers_hint: int | None
```

### 8.6 `memory.query_similar` / `memory.record`

Wraps del repository. Exposats com a tools perquè els agents els puguin invocar.

### 8.7 `validate_lead`

Codi pur, no LLM. Executa els 5 checks i retorna boolean map.

```python
class ValidateLeadInput(BaseModel):
    lead: Lead  # the candidate

class ValidateLeadOutput(BaseModel):
    checks: dict[str, bool]
    # website_reachable, business_active, fits_segment,
    # contact_verifiable, not_excluded
    overall_score: int  # 0-5
```

---

## 9. Capa de validació (Fact-Checker)

### 9.1 Extracció de claims

El Fact-Checker, abans de verificar, extreu claims amb un pas determinista:

```python
# src/fact_checker/claim_extractor.py
class Claim(BaseModel):
    text: str
    source_agent: Literal["investigator", "strategist", "lead_hunter"]
    claimed_source_url: HttpUrl | None
    claim_type: Literal["competitor_exists", "price", "channel", "company_exists", "contact", "statistic", "event"]
    location_in_output: str  # JSON path, e.g. "competitors[0].price_range"
```

L'extracció es fa cridant Claude amb el bundle i un prompt de "extract all factual claims, one per object, with location". Output estructurat.

### 9.2 Verificació

Per cada claim:
1. Si té `claimed_source_url`: fetch, check that the page supports the claim.
2. Si no: web_search for the specific claim, fetch top 3 results, check.
3. Classify: verified / unverifiable / contradicted.

### 9.3 Blocking rules

Es bloqueja el run (no s'entrega al Director) si:
- `verification_rate < 0.80`
- Qualsevol `contact` d'un lead està `contradicted`
- Qualsevol `competitor_exists` o `company_exists` està `contradicted`

---

## 10. Gestió d'errors i degradació

### 10.1 Taxonomia d'errors

| Classe                   | Causa                                    | Resposta del sistema                               |
|--------------------------|------------------------------------------|----------------------------------------------------|
| `SchemaValidationError`  | LLM retorna JSON invàlid                 | Reintentar fins a 3 cops amb feedback de Pydantic  |
| `WeakOutputError`        | Output passa schema però no invariants   | 1 revisió amb feedback, llavors abort              |
| `BudgetExceededError`    | Cost o tokens sobre el cap               | Abort amb entrega parcial                          |
| `ToolError`              | Web search, fetch, DB fallen             | Retry amb tenacity (backoff exponencial, 3 cops)  |
| `VerificationBlockedError` | Fact-Checker trova blocking issues     | Parar i entregar al Director amb flags            |
| `CheckpointRejectedError`| Director rebutja a un checkpoint         | Abort o revisió segons instrucció del Director     |

### 10.2 Degradació amb gràcia

Si s'aborta a mig run, el Manager ha de retornar un `PartialReport`:

```python
class PartialReport(BaseModel):
    run_id: str
    completed_states: list[State]
    partial_outputs: dict[str, Any]  # whatever was obtained
    abort_reason: str
    recoverable: bool  # can the user retry from the last checkpoint?
```

Això es persisteix igual que un informe complet, perquè el Director pugui reprendre.

---

## 11. Cost control i rate limiting

### 11.1 BudgetTracker

```python
# src/orchestration/budget.py
class Budget(BaseModel):
    max_usd: float
    max_tokens: int
    max_tool_calls: int

class BudgetTracker:
    def __init__(self, budget: Budget):
        self.budget = budget
        self.spent_usd = 0.0
        self.spent_tokens = 0
        self.tool_calls = 0

    def record_llm(self, model: str, in_tokens: int, out_tokens: int) -> None: ...
    def record_tool(self) -> None: ...
    def check(self) -> None:
        """Raise BudgetExceededError if any cap passed."""
```

### 11.2 Preus de referència (abril 2026)

| Model              | Input $/Mtok | Output $/Mtok |
|--------------------|--------------|---------------|
| claude-opus-4-6    | 15.00        | 75.00         |
| claude-sonnet-4-6  | 3.00         | 15.00         |

El tracker usa aquests valors (configurables via `settings.pricing`) per calcular `spent_usd` en temps real.

### 11.3 Estimació de cost per run (Fase 1, tot Sonnet)

| Agent          | Tokens in | Tokens out | Cost estimat |
|----------------|-----------|------------|--------------|
| Manager        | 10k       | 5k         | ~0.08 €      |
| Investigator   | 50k       | 10k        | ~0.30 €      |
| Strategist     | 15k       | 5k         | ~0.08 €      |
| Lead Hunter    | 60k       | 15k        | ~0.40 €      |
| Fact-Checker   | 25k       | 5k         | ~0.12 €      |
| **Total LLM**  | 160k      | 40k        | **~1.00 €**  |
| Cerques web (Exa + Brave, ~40 crides) | | | ~0.20 € |
| **Total esperat per run** | | | **~1.20–1.80 €** |

Amb reintents, Fact-Checker detectant claims problemàtics, i casos complexos: sostre pràctic **~2.50 €**. El cap dur es manté a **5.00 €** per seguretat.

### 11.4 Pressupost per defecte d'un run

```python
DEFAULT_BUDGET = Budget(
    max_usd=3.00,           # cap Fase 1; promoure a 5 quan Manager passi a Opus
    max_tokens=400_000,
    max_tool_calls=150,
)
```

Configurable per crida CLI: `seito run --budget-usd 2.00`.

### 11.4 Rate limiting extern

- **Anthropic:** respectar 429s amb `Retry-After`. Tenacity.
- **Exa / Brave:** semàfor asíncron amb cap a 2 crides concurrents.
- **Scraping:** per-host rate limit (vegeu §8.3).

---

## 12. Observabilitat i traçabilitat

### 12.1 Logging estructurat

`structlog` amb JSON output a stdout + rotació a `logs/seito-YYYYMMDD.jsonl`.

```python
# src/observability/logger.py
import structlog
log = structlog.get_logger()

log.info("agent_called",
    run_id=run_id,
    agent="investigator",
    brief_hash=hash_of(brief),
    tokens_in=prompt_tokens,
    budget_remaining_usd=budget.remaining_usd())
```

### 12.2 Events persistits

Cada transició d'estat, crida LLM, crida tool, error, checkpoint → fila a `run_events`. Això permet reconstruir l'execució sencera posteriorment.

### 12.3 Tracing (opcional fase 1, recomanat fase 2)

OpenTelemetry exporter a LangFuse o Jaeger. Cada `agent.run()` és un span. Cada `tool.execute()` és un span fill. Permet veure en un UI quines crides van tardar i quines van costar.

### 12.4 Replay i debug

El logger desa també els prompts i respostes senceres (pla text, no a la DB per volum). `./scripts/replay.py <run_id>` permet re-executar un run offline amb les respostes gravades — útil per iterar en prompts sense cremar API calls.

---

## 13. Human-in-the-loop

### 13.1 Checkpoints

Tres punts fixes. El Director pot:
- **Approve** → continuar
- **Request revision** → el Manager demana a l'agent anterior una revisió amb el feedback textual del Director
- **Abort** → terminar el run amb estat ABORTED

### 13.2 Mode autonomous

`--autonomous` salta els checkpoints però continua loggant-los com a `checkpoint_auto_approved`. Recomanació: **no usar en producció fins 10 runs reeixits amb checkpoints**.

### 13.3 Interfície del checkpoint (CLI de la Fase 1)

```
╭────────────────────────────────────────────────────────╮
│ CHECKPOINT 1 — Market Research Complete                │
│ Run: b2c4...ff                                          │
│ Cost so far: 0.62 EUR   Tokens: 48k   Time: 1m 42s      │
├────────────────────────────────────────────────────────┤
│ Competitors found: 5                                    │
│ Opportunities flagged: 3                                │
│ Open questions: 1                                       │
│                                                         │
│ Full research: ./out/b2c4-research.json                 │
│                                                         │
│ [a] approve   [r] request revision   [x] abort          │
╰────────────────────────────────────────────────────────╯
```

---

## 14. Estructura del projecte

```
seito-marketing-ai/
├── README.md
├── pyproject.toml
├── .env.example
├── docker-compose.yml
├── alembic.ini
├── alembic/
│   └── versions/
│       └── 001_initial.py
├── src/
│   ├── __init__.py
│   ├── cli.py                      # Typer entrypoint
│   ├── settings.py                 # pydantic-settings, loads .env
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── base.py                 # Agent protocol, LLM call wrapper
│   │   ├── manager.py
│   │   ├── investigator.py
│   │   ├── strategist.py
│   │   ├── lead_hunter.py
│   │   └── fact_checker.py
│   ├── prompts/
│   │   ├── manager.md
│   │   ├── investigator.md
│   │   ├── strategist.md
│   │   ├── lead_hunter.md
│   │   └── fact_checker.md
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── business.py
│   │   ├── research.py
│   │   ├── strategy.py
│   │   ├── leads.py
│   │   ├── verification.py
│   │   ├── report.py
│   │   └── briefs.py
│   ├── tools/
│   │   ├── __init__.py
│   │   ├── base.py
│   │   ├── web_search.py
│   │   ├── fetch_url.py
│   │   ├── scrape_structured.py
│   │   ├── linkedin.py
│   │   ├── memory.py
│   │   └── validate_lead.py
│   ├── memory/
│   │   ├── __init__.py
│   │   ├── db.py                   # SQLAlchemy engine
│   │   ├── models.py               # ORM
│   │   └── repository.py
│   ├── orchestration/
│   │   ├── __init__.py
│   │   ├── workflow.py             # state machine
│   │   ├── budget.py
│   │   ├── checkpoints.py
│   │   └── validators.py           # post-output invariants
│   ├── fact_checker/
│   │   ├── __init__.py
│   │   └── claim_extractor.py
│   └── observability/
│       ├── __init__.py
│       ├── logger.py
│       └── tracing.py
├── tests/
│   ├── unit/
│   │   ├── test_schemas.py
│   │   ├── test_validators.py
│   │   └── test_budget.py
│   ├── integration/
│   │   ├── test_workflow_happy_path.py
│   │   └── test_workflow_degradation.py
│   └── fixtures/
│       └── cassettes/              # pytest-recording VCR
├── scripts/
│   ├── replay.py
│   └── seed_business.py
└── evals/
    ├── golden_leads/               # 10 hand-picked leads for Seito Camera
    └── run_eval.py
```

---

## 15. Testing i avaluació

### 15.1 Unit tests

- Schemes: casos de validació (manca de source, length, enum values).
- Validators: `WeakOutputError` es llança quan esperat.
- Budget: càlculs correctes per model, enforcement dels caps.

### 15.2 Integration tests

Usar `pytest-recording` per gravar respostes de l'API d'Anthropic en un run real, i llavors replay offline. Això permet testar workflow complet sense cremar API calls en CI.

### 15.3 Eval dataset

**Crític:** abans de confiar en el sistema, necessitem un ground truth.

Seito ha proporcionat (abril 2026) els conjunts inicials:

**Golden competitors (`evals/golden_competitors/seito_camera.json`)** — 5 competidors:
- Napalm Rentals
- Zig Zag Rental
- Servicevision
- Camera Lenses Rental
- Ovide

**Golden leads (`evals/golden_leads/seito_camera.json`)** — 11 productores ideals:
- Caminofilms.tv
- Possible Films
- Altiplà Films
- Barcelona Production
- Twentyfour Seven
- Blua
- Production Club
- Agosto
- Mamma Team
- Roma (Salve Roma)
- Vampire Films

> Els competidors encara estan al conjunt inicial de 5; ampliar a ~10 abans de la Fase 2. El conjunt de leads ja supera els 10, cosa que dóna més senyal des del primer run. Cada entrada al fitxer JSON ha d'incloure: nom canònic, URL verificada, 1-2 frases de "per què és ideal" (només golden_leads), i data de verificació. Les plantilles estan a `evals/` amb placeholders per als camps que Seito ha de completar.

El `run_eval.py`:
1. Corre el workflow complet per Seito Camera.
2. Compara `MarketResearch.competitors` amb el golden set → reporta recall (quants dels 5 troba) i precision.
3. Compara `LeadList.leads` amb el golden set → reporta si troba ≥4 de les 11 (pass) o ≥8 (strong pass).
4. Reporta mètriques i flagueja regressions respecte al run anterior.

Aquest dataset és el que permet iterar en prompts sense volar a cegues.

### 15.4 Red-team prompts

Carpeta `evals/red_team/` amb briefs adversaris:
- "Business" buit o mal format.
- Nínxol amb zero competidors reals.
- Ubicació inexistent.
- Segment exclòs que s'hauria de respectar.

El sistema ha de fallar gracefully, no inventar.

---

## 16. Roadmap d'implementació (Fase 1 — 2-3 setmanes)

### Setmana 1 — Fonaments

- D1: `pyproject`, `docker-compose`, Alembic migrations, schemes Pydantic complets, testos unitaris d'schemes.
- D2: Tools `web_search`, `fetch_url`, `validate_lead`. Testos amb VCR.
- D3: `Agent` base class, LLM call wrapper amb retry, extraction de JSON, schema validation.
- D4: Investigator end-to-end amb prompt v1, run manual contra Seito Camera.
- D5: Iterar prompt de l'Investigator fins que el run contra Seito doni 5 competidors reals amb sources.

### Setmana 2 — Agents especialistes

- D6: Strategist end-to-end, testos amb el MarketResearch de la setmana anterior.
- D7: Iteració prompt Strategist, focus en `creativity_notes` no trivial.
- D8: Lead Hunter end-to-end + `validate_lead`.
- D9: Iteració Lead Hunter fins que 7/10 leads passin validation_checks.
- D10: Fact-Checker end-to-end, claim extractor.

### Setmana 3 — Orquestració i CLI

- D11: State machine del workflow, BudgetTracker integrat.
- D12: Manager amb delegation via Task tool, memòria bàsica.
- D13: CLI Typer amb comandes `run`, `resume`, `replay`. Checkpoints interactius.
- D14: Eval dataset manual amb Seito, primer run oficial end-to-end.
- D15: Fix del que Eval reveli, documentació d'ús, handoff.

### Criteris d'acceptació de la Fase 1

- Un `seito run seito-camera.json` completa en <5 min.
- L'informe té ≥4 competidors amb fonts, ≥3 angles considerats, ≥6 leads verificats.
- Cost <3 € per run (sota el cap de 5 €).
- `verification_rate ≥ 0.85`.
- 0 empreses o contactes inventats en la mostra manual.

---

## 17. Apèndix A — Exemple end-to-end abreujat

### Input

```json
{
  "name": "Seito Camera",
  "description": "Lloguer de material audiovisual professional: càmeres ARRI, òptiques de cinema, accessoris de producció.",
  "vertical": "audiovisual equipment rental",
  "location": "Barcelona",
  "target_customers": ["production companies", "independent DPs", "advertising agencies"],
  "unique_strengths": ["ARRI-specialized", "hands-on technical support on-set"],
  "known_competitors": [],
  "language": "ca",
  "goals": ["more high-end ad-production clients"],
  "excluded_segments": ["weekend amateurs", "streaming setup rentals"]
}
```

### Traça resumida d'una execució

```
[init]    run_id=b2c4-...
[research] delegate investigator  brief.depth=3
[research] investigator tool: web_search("lloguer càmeres ARRI Barcelona")
[research] investigator tool: fetch_url("https://competitorA.example/preus")
[research] investigator output: 5 competitors, 3 opportunities, 1 open_question
[research] validator: OK
[checkpoint_1] auto-approved (autonomous=true)
[strategy] delegate strategist  brief.research=<...>
[strategy] strategist output: 3 angles, chosen="Technical authority on-set"
[strategy] validator: OK
[leads]   delegate lead_hunter  brief.target_count=10
[leads]   lead_hunter tool: web_search("productores audiovisuals Barcelona ARRI")
[leads]   lead_hunter tool: fetch_url x 18
[leads]   lead_hunter output: 8 leads, 14 rejected
[verify]  delegate fact_checker
[verify]  fact_checker: 42 claims, 38 verified, 4 unverifiable, 0 contradicted
[finalize] ExecutiveReport generated
[persist_memory] 2 insights recorded
[done]    cost=2.14 EUR  tokens=287k  duration=3m 48s
```

### Output (resum executiu)

> **Informe Executiu — Seito Camera**
>
> El mercat de lloguer cinematogràfic a Barcelona està dominat per 5 cases (veure detall), amb preus que oscil·len entre 45 € i 90 €/dia per a càmeres comparables. Cap competidor ha construït autoritat tècnica pública — l'angle recomanat és "l'únic lloguer amb suport tècnic a peu de rodatge", suportat amb contingut a LinkedIn i Vimeo dirigit a DPs. Hem identificat 8 productores a BCN amb probabilitat alta d'encaixar (ARRI-users actius, projectes publicats els últims 6 mesos), amb rutes d'outreach específiques per cada una.

---

## 18. Apèndix B — Checklist de seguretat i GDPR

- [ ] User-Agent identificable en totes les requests de scraping.
- [ ] Respecte a `robots.txt` comprovat abans de cada fetch.
- [ ] Rate limit per domini configurat i auditable.
- [ ] Dades personals de contactes: només les públicament disponibles en la web corporativa o LinkedIn company page. Cap harvesting de LinkedIn profiles.
- [ ] Emails guessed mai marcats com a `verified` en el schema.
- [ ] Registre en `run_events` de quina URL s'ha consultat quan, per auditoria.
- [ ] Mecanisme per eliminar dades d'una empresa sota petició (`scripts/redact_company.py`).
- [ ] No emmagatzemar passwords, tokens o dades financeres en cap schema.
- [ ] `.env` a `.gitignore`. Secrets via variable d'entorn o Vault, mai committed.
- [ ] API keys d'Anthropic, Exa, Brave rotables via settings.
- [ ] Accés a la DB restringit a la màquina local en la Fase 1.

---

**Fi del document v1.1.**

*Decisions tancades en la iteració v1 → v1.1 (amb Seito, 2026-04-21):*
1. ✅ Manager amb **Sonnet 4.6** en Fase 1 (no Opus). Revisió del model decidida als 10 primers runs reals.
2. ✅ **Multi-llengua des del dia 1** (ca/es/en). Nou principi P8 afegit.
3. ✅ Eval dataset inicial proporcionat per Seito (5 competidors + 5 productores). Plantilles JSON a `evals/` pendents d'enriquiment de camps.

*Pendent abans d'arrencar setmana 1 de la implementació:*
- Verificar URLs i completar plantilles `evals/golden_*.json` amb camps addicionals (Seito, ~30 min de feina amb un xec de la seva pàgina web de cada empresa).
- Obtenir API keys: Anthropic, Exa, Brave.
- `docker compose up` per tenir Postgres + pgvector disponible.
