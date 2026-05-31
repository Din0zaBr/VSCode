from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select

from ursus.application.common.ports.inbox import InboxStore
from ursus.infrastructure.persistence.models.common.inbox import InboxMessage

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession


class SqlAlchemyInboxStore(InboxStore):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def seen(self, event_id: UUID) -> bool:
        result = await self._session.execute(
            select(InboxMessage.event_id).where(InboxMessage.event_id == event_id),
        )
        return result.first() is not None

    async def mark_processed(self, event_id: UUID) -> None:
        self._session.add(InboxMessage(event_id=event_id))
