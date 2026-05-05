"""State machine for a single run.

See ../../ARQUITECTURA_TECNICA.md §6 for the full state diagram.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

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
