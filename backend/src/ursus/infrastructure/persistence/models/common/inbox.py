from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Mapped, mapped_column

from ursus.infrastructure.persistence.base import Base
from ursus.infrastructure.persistence.schemas import MESSAGING_SCHEMA


class InboxMessage(Base):
    __tablename__ = "inbox"
    __table_args__ = {"schema": MESSAGING_SCHEMA}

    event_id: Mapped[UUID] = mapped_column(primary_key=True)
    processed_at: Mapped[datetime] = mapped_column(server_default=func.now())
