from __future__ import annotations

from datetime import datetime
from typing import Any, ClassVar
from uuid import UUID

from sqlalchemy import DateTime, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ursus.infrastructure.persistence.base import Base
from ursus.infrastructure.persistence.schemas import MESSAGING_SCHEMA


class OutboxMessage(Base):
    __tablename__ = "outbox"
    __table_args__: ClassVar[dict[str, str]] = {"schema": MESSAGING_SCHEMA}  # type: ignore[misc]

    event_id: Mapped[UUID] = mapped_column(primary_key=True)
    event_type: Mapped[str]
    schema_version: Mapped[int]
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
