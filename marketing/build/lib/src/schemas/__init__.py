"""Pydantic schemas — the contracts between agents. Every inter-agent message is typed."""
from .business import BusinessContext
from .research import MarketResearch, Competitor, MarketOpportunity, PriceRange, Source
from .strategy import CampaignStrategy, Angle, ChannelPlan
from .leads import LeadList, Lead, Contact
from .verification import VerificationReport, ClaimVerification
from .report import ExecutiveReport, CostBreakdown
from .briefs import ResearchBrief, StrategyBrief, LeadBrief

__all__ = [
    "BusinessContext",
    "MarketResearch",
    "Competitor",
    "MarketOpportunity",
    "PriceRange",
    "Source",
    "CampaignStrategy",
    "Angle",
    "ChannelPlan",
    "LeadList",
    "Lead",
    "Contact",
    "VerificationReport",
    "ClaimVerification",
    "ExecutiveReport",
    "CostBreakdown",
    "ResearchBrief",
    "StrategyBrief",
    "LeadBrief",
]
