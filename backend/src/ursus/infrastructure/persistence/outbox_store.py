from __future__ import annotations

from typing import TYPE_CHECKING

from ursus.application.common.ports.outbox import OutboxStore
from ursus.infrastructure.persistence.models.common.outbox import OutboxMessage

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from ursus.application.common.events.integration_event import EventEnvelope


class SqlAlchemyOutboxStore(OutboxStore):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def add(self, envelope: EventEnvelope) -> None:
        self._session.add(
            OutboxMessage(
                event_id=envelope.event_id,
                event_type=envelope.event_type,
                schema_version=envelope.schema_version,
                occurred_at=envelope.occurred_at,
                payload=envelope.payload,
            ),
        )
