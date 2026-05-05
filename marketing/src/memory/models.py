"""SQLAlchemy ORM models. See ARQUITECTURA_TECNICA.md §7 for the schema."""
from __future__ import annotations
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Text, DateTime, Boolean, Integer, Numeric, BigInteger
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID, ARRAY
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# pgvector SQLAlchemy type (requires `from pgvector.sqlalchemy import Vector` at usage)


class Base(DeclarativeBase):
    pass


class Business(Base):
    __tablename__ = "businesses"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    vertical: Mapped[str] = mapped_column(Text, nullable=False)
    location: Mapped[str] = mapped_column(Text, nullable=False)
    context: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class Run(Base):
    __tablename__ = "runs"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    business_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("businesses.id"))
    state: Mapped[str] = mapped_column(Text, nullable=False)
    autonomous: Mapped[bool] = mapped_column(Boolean, nullable=False)
    report: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Numeric(10, 4), nullable=True)
    tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    events: Mapped[list["RunEvent"]] = relationship(back_populates="run", cascade="all, delete-orphan")


class RunEvent(Base):
    __tablename__ = "run_events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("runs.id"))
    agent: Mapped[str] = mapped_column(Text, nullable=False)
    event: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    run: Mapped["Run"] = relationship(back_populates="events")


class LeadOutcome(Base):
    __tablename__ = "lead_outcomes"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("runs.id"))
    lead_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    contacted: Mapped[bool] = mapped_column(Boolean, default=False)
    contacted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    response: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


# NOTE: Insight model with pgvector column — see alembic/versions/001_initial.py.
# Keeping it out of here to avoid importing pgvector at module level; it's an infra concern.
