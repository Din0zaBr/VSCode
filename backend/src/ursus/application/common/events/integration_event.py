from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, ClassVar
from uuid import UUID


@dataclass(frozen=True, kw_only=True)
class IntegrationEvent:
    """Flat, versioned cross-context contract.

    Subclasses set ``event_type`` and ``schema_version`` as class attributes and
    declare their payload as additional frozen-dataclass fields.
    """

    event_type: ClassVar[str]
    schema_version: ClassVar[int]

    event_id: UUID
    occurred_at: datetime


@dataclass(frozen=True, kw_only=True)
class EventEnvelope:
    """Transport/outbox shape: routing metadata + dumped event body."""

    event_id: UUID
    event_type: str
    schema_version: int
    occurred_at: datetime
    payload: dict[str, Any]
