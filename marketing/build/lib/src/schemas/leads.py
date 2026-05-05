"""Output of the Lead Hunter agent."""
from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, HttpUrl


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
    size_hint: str | None = None
    why_good_fit: str
    fit_score: int = Field(..., ge=1, le=10)
    evidence: list[HttpUrl] = Field(..., min_length=1)
    contacts: list[Contact] = Field(default_factory=list)
    suggested_outreach: str
    validation_checks: dict[str, bool] = Field(
        ...,
        description=(
            "Must include: website_reachable, business_active, fits_segment, "
            "contact_verifiable, not_excluded"
        ),
    )


class LeadList(BaseModel):
    strategy_reference: str
    leads: list[Lead] = Field(..., min_length=1, max_length=15)
    rejected_candidates: int = Field(..., ge=0)
    rejection_reasons: dict[str, int] = Field(default_factory=dict)
    generated_at: datetime
    tokens_used: int = Field(..., ge=0)
