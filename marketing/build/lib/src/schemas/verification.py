"""Output of the Fact-Checker agent."""
from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


class ClaimVerification(BaseModel):
    claim: str
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
    blocking_issues: list[str] = Field(
        default_factory=list, description="Issues severe enough to block delivery"
    )
    generated_at: datetime
    tokens_used: int = Field(..., ge=0)

    @property
    def verification_rate(self) -> float:
        return self.verified / self.total_claims if self.total_claims else 0.0
