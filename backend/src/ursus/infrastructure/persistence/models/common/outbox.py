from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ursus.infrastructure.persistence.base import Base
from ursus.infrastructure.persistence.schemas import MESSAGING_SCHEMA


class OutboxMessage(Base):
    __tablename__ = "outbox"
    __table_args__ = {"schema": MESSAGING_SCHEMA}

    event_id: Mapped[UUID] = mapped_column(primary_key=True)
    event_type: Mapped[str]
    schema_version: Mapped[int]
    occurred_at: Mapped[datetime]
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    published_at: Mapped[datetime | None] = mapped_column(default=None)
