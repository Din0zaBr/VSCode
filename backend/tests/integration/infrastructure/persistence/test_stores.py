from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import text

from ursus.application.common.events.integration_event import EventEnvelope
from ursus.infrastructure.persistence.inbox_store import SqlAlchemyInboxStore
from ursus.infrastructure.persistence.outbox_store import SqlAlchemyOutboxStore

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


async def test_outbox_store_persists_envelope(session: AsyncSession) -> None:
    store = SqlAlchemyOutboxStore(session)
    event_id = uuid4()
    await store.add(
        EventEnvelope(
            event_id=event_id,
            event_type="test.thing",
            schema_version=1,
            occurred_at=datetime.now(UTC),
            payload={"thing_id": "abc"},
        ),
    )
    await session.flush()
    row = await session.execute(
        text("SELECT event_type, payload FROM messaging.outbox WHERE event_id = :id"),
        {"id": event_id},
    )
    event_type, payload = row.one()
    assert event_type == "test.thing"
    assert payload == {"thing_id": "abc"}


async def test_inbox_store_tracks_processed_ids(session: AsyncSession) -> None:
    store = SqlAlchemyInboxStore(session)
    event_id = uuid4()
    assert await store.seen(event_id) is False
    await store.mark_processed(event_id)
    await session.flush()
    assert await store.seen(event_id) is True
