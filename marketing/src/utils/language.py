"""Language post-processor — fixes recurring catalanismes/castellanisms that
local LLMs (Qwen3 etc.) produce when generating Catalan or Spanish text.

Conservative by design: only fixes patterns observed multiple times in real
runs and where the correction is unambiguous. We'd rather under-correct than
introduce a wrong word.

Apply via `polish_dict(obj, lang)` — walks any nested dict/list and applies
the language-specific rules to string leaves. URL-shaped strings are skipped.
"""
from __future__ import annotations
import re
from typing import Any


# ---------------------------------------------------------------------------- #
# Catalan substitutions — observed in qwen3:32b output for Seito Camera runs.
# Pattern → replacement (regex, case-insensitive, word-boundary aware).
#
# Add entries with care: the model isn't catastrophically bad at Catalan,
# only sloppy with low-frequency words. Each rule fixes a SPECIFIC mistake,
# not a general translation.
# ---------------------------------------------------------------------------- #

# Each tuple: (regex_pattern, replacement)
CATALAN_FIXES: list[tuple[re.Pattern, str]] = [
    # Hybrid English/Catalan words
    (re.compile(r"\benda-enda\b", re.IGNORECASE),       "punta a punta"),
    (re.compile(r"\bsub-hire\b", re.IGNORECASE),        "subcontracten"),
    (re.compile(r"\bsub-hiren\b", re.IGNORECASE),       "subcontracten"),
    (re.compile(r"\bConselharia\b"),                    "Assessoria"),
    (re.compile(r"\bconselharia\b"),                    "assessoria"),
    # English words bleeding into Catalan
    (re.compile(r"(?<=\s)but(?=\s)", re.IGNORECASE),    "però"),
    (re.compile(r"\borçament\b"),                       "pressupost"),
    # Spelling
    (re.compile(r"\bTassa\s+de\b"),                     "Taxa de"),
    (re.compile(r"\btassa\s+de\b"),                     "taxa de"),
    (re.compile(r"\bseguents\b"),                       "seguidors"),
    (re.compile(r"\bSeguents\b"),                       "Seguidors"),
    (re.compile(r"\bBoletí\b"),                         "Butlletí"),
    (re.compile(r"\bboletí\b"),                         "butlletí"),
    # Castilian-style accents in Catalan
    (re.compile(r"\bdías\b"),                           "dies"),
    (re.compile(r"\bcámeras?\b"),                       "càmera"),  # imperfect: singular form
    (re.compile(r"\bproductoras\b"),                    "productores"),
    (re.compile(r"\bproductora(?=[\s\.,;:!?])\b"),      "productora"),  # no-op safety
    # Stranded foreign characters (Qwen leaks Chinese/Japanese tokens)
    (re.compile(r"[　-鿿぀-ヿ]+"),      ""),
]

# ---------------------------------------------------------------------------- #
# Spanish substitutions — minimal set so we don't over-correct.
# ---------------------------------------------------------------------------- #
SPANISH_FIXES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\benda-enda\b", re.IGNORECASE),       "de extremo a extremo"),
    (re.compile(r"\bsub-hire\b", re.IGNORECASE),        "subcontratan"),
    (re.compile(r"(?<=\s)but(?=\s)", re.IGNORECASE),    "pero"),
    (re.compile(r"[　-鿿぀-ヿ]+"),      ""),
]

# Whitespace cleanup applied always
_WS_FIXES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\s{2,}"),        " "),
    (re.compile(r"\s+([.,;:!?])"), r"\1"),
]


_URL_RE = re.compile(r"^https?://", re.IGNORECASE)


def polish_string(text: str, lang: str) -> str:
    """Apply language-specific fixes to a single string. URLs untouched."""
    if not isinstance(text, str) or not text:
        return text
    if _URL_RE.match(text):
        return text  # never touch URLs
    rules = CATALAN_FIXES if lang == "ca" else SPANISH_FIXES if lang == "es" else []
    out = text
    for pat, rep in rules:
        out = pat.sub(rep, out)
    for pat, rep in _WS_FIXES:
        out = pat.sub(rep, out)
    return out


def polish_dict(obj: Any, lang: str) -> Any:
    """Walk a nested dict/list and apply `polish_string` to every string leaf.

    Returns a new structure (does not mutate the input). Dict keys are NOT
    polished (they're field names, must stay as-is).
    """
    if isinstance(obj, dict):
        return {k: polish_dict(v, lang) for k, v in obj.items()}
    if isinstance(obj, list):
        return [polish_dict(v, lang) for v in obj]
    if isinstance(obj, str):
        return polish_string(obj, lang)
    return obj
