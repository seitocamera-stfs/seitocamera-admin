"""Budget tracking — hard caps on USD, tokens, tool calls.

Usage:
    budget = BudgetTracker(Budget(max_usd=3.0, max_tokens=400_000, max_tool_calls=150))
    budget.record_llm("claude-sonnet-4-5-20250929", in_tokens=5000, out_tokens=1500)
    budget.check()  # raises BudgetExceededError if any cap passed

Pricing strategy:
    1. Match per família (sonnet/opus/haiku) via regex — robust a noves versions.
    2. Models locals (qwen3:*, llama3.*, deepseek-*, gemma*, mistral*) → $0, sense warn.
    3. Model desconegut → WARN una vegada + assigna preu Sonnet com a fallback
       conservador (preferim sobre-estimar abans que sub-estimar i no parar mai).
"""
from __future__ import annotations
import logging
import re
from pydantic import BaseModel, Field

from ..settings import settings

logger = logging.getLogger(__name__)


class Budget(BaseModel):
    max_usd: float = Field(..., gt=0)
    max_tokens: int = Field(..., gt=0)
    max_tool_calls: int = Field(..., gt=0)


class BudgetExceededError(Exception):
    """Raised when the run exceeds any configured cap."""


# Pricing per família (USD per milió de tokens). Valors d'octubre 2025
# segons preus públics d'Anthropic. Ajustables per env via settings.
_FAMILY_PRICING: dict[str, tuple[float, float]] = {
    # input_per_mtok, output_per_mtok
    "sonnet": (settings.price_sonnet_input_per_mtok, settings.price_sonnet_output_per_mtok),
    "opus":   (settings.price_opus_input_per_mtok, settings.price_opus_output_per_mtok),
    "haiku":  (1.00, 5.00),  # Haiku 4.x; 3.5 = $0.80/$4, 3 = $0.25/$1.25
}

# Models locals → cost 0. Cap warn si matcheja qualsevol d'aquests prefixos.
_LOCAL_MODEL_PREFIXES = (
    "qwen", "llama", "deepseek", "gemma", "mistral", "mixtral",
    "phi", "yi", "command", "neural-chat", "openchat", "tinyllama",
    "ollama", "local",
)

# Cache de pricing resolt per model (memoritza resultat de regex match)
_pricing_cache: dict[str, tuple[float, float, bool]] = {}  # model → (in, out, is_fallback)
_warned_models: set[str] = set()


def _pricing_for(model: str) -> tuple[float, float, bool]:
    """Retorna (input_per_mtok, output_per_mtok, used_fallback) per a un model.

    Si és model local conegut → (0, 0, False).
    Si encaixa amb família Anthropic → preus reals.
    Si no encaixa → preus Sonnet com a fallback + WARN una vegada.
    """
    if model in _pricing_cache:
        return _pricing_cache[model]

    m = (model or "").lower().strip()

    # Local models — gratis, no warn
    for prefix in _LOCAL_MODEL_PREFIXES:
        if m.startswith(prefix):
            result = (0.0, 0.0, False)
            _pricing_cache[model] = result
            return result

    # Family match (claude-sonnet-*, claude-opus-*, claude-haiku-*)
    family_match = re.match(r"^claude-(sonnet|opus|haiku)\b", m)
    if family_match:
        family = family_match.group(1)
        in_p, out_p = _FAMILY_PRICING[family]
        result = (in_p, out_p, False)
        _pricing_cache[model] = result
        return result

    # Desconegut — WARN una vegada i usa preus Sonnet (conservador)
    if model not in _warned_models:
        logger.warning(
            "Budget: model desconegut '%s'. Usant pricing Sonnet com a fallback "
            "($%.2f in / $%.2f out per Mtok). Afegeix una entrada explícita a _FAMILY_PRICING "
            "o renomena el model a la convenció claude-{family}-... per evitar aquest fallback.",
            model,
            _FAMILY_PRICING["sonnet"][0],
            _FAMILY_PRICING["sonnet"][1],
        )
        _warned_models.add(model)
    in_p, out_p = _FAMILY_PRICING["sonnet"]
    result = (in_p, out_p, True)
    _pricing_cache[model] = result
    return result


def _reset_pricing_cache() -> None:
    """Test helper: oblida cache i warnings (per a tests amb settings overrides)."""
    _pricing_cache.clear()
    _warned_models.clear()


class BudgetTracker:
    def __init__(self, budget: Budget) -> None:
        self.budget = budget
        self.spent_usd = 0.0
        self.spent_tokens = 0
        self.tool_calls = 0
        self.per_agent_usd: dict[str, float] = {}
        self.fallback_models: set[str] = set()  # Per a diagnòstic post-run

    def record_llm(self, model: str, in_tokens: int, out_tokens: int, agent: str = "unknown") -> None:
        in_price, out_price, used_fallback = _pricing_for(model)
        if used_fallback:
            self.fallback_models.add(model)
        cost = (in_tokens * in_price + out_tokens * out_price) / 1_000_000
        self.spent_usd += cost
        self.spent_tokens += in_tokens + out_tokens
        self.per_agent_usd[agent] = self.per_agent_usd.get(agent, 0.0) + cost

    def record_tool(self) -> None:
        self.tool_calls += 1

    def remaining_usd(self) -> float:
        return max(0.0, self.budget.max_usd - self.spent_usd)

    def check(self) -> None:
        if self.spent_usd >= self.budget.max_usd:
            raise BudgetExceededError(f"USD cap hit: spent {self.spent_usd:.2f}/{self.budget.max_usd:.2f}")
        if self.spent_tokens >= self.budget.max_tokens:
            raise BudgetExceededError(f"Token cap hit: {self.spent_tokens}/{self.budget.max_tokens}")
        if self.tool_calls >= self.budget.max_tool_calls:
            raise BudgetExceededError(f"Tool call cap hit: {self.tool_calls}/{self.budget.max_tool_calls}")
