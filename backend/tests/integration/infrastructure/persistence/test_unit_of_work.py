from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy import text

from ursus.application.common.events.integration_event import IntegrationEvent
from ursus.domain.common.aggregate_root import AggregateRoot
from ursus.domain.common.domain_event import DomainEvent
from ursus.domain.common.entity_id import EntityId
from ursus.infrastructure.event_bus.serializer import IntegrationEventSerializer
from ursus.infrastructure.mappers.registry import IntegrationEventRegistry
from ursus.infrastructure.persistence.outbox_store import SqlAlchemyOutboxStore
from ursus.infrastructure.persistence.unit_of_work import SqlAlchemyUnitOfWork

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True, kw_only=True)
class ThingDone(DomainEvent):
    label: str


@dataclass(frozen=True, kw_only=True)
class ThingDoneIntegration(IntegrationEvent):
    event_type = "test.thing_done"
    schema_version = 1
    label: str


def _translate(event: DomainEvent) -> IntegrationEvent:
    assert isinstance(event, ThingDone)
    return ThingDoneIntegration(
        event_id=event.event_id, occurred_at=event.occurred_at, label=event.label
    )


class _Thing(AggregateRoot):
    pass


def _build_uow(session: AsyncSession) -> SqlAlchemyUnitOfWork:
    registry = IntegrationEventRegistry()
    registry.register(ThingDone, _translate)
    return SqlAlchemyUnitOfWork(
        session=session,
        outbox=SqlAlchemyOutboxStore(session),
        registry=registry,
        serializer=IntegrationEventSerializer(),
    )


async def test_commit_drains_domain_events_into_outbox(session: AsyncSession) -> None:
    uow = _build_uow(session)
    thing = _Thing(EntityId.generate())
    event = ThingDone(label="hello")
    thing.record_event(event)

    uow.track(thing)
    await uow.commit()

    row = await session.execute(
        text(
            "SELECT event_type, schema_version, payload "
            "FROM messaging.outbox WHERE event_id = :id"
        ),
        {"id": event.event_id},
    )
    event_type, schema_version, payload = row.one()
    assert event_type == "test.thing_done"
    assert schema_version == 1
    assert payload["label"] == "hello"
    assert thing.collect_events() == []  # events were drained


async def test_commit_skips_unregistered_events(session: AsyncSession) -> None:
    uow = _build_uow(session)
    thing = _Thing(EntityId.generate())
    thing.record_event(DomainEvent())  # not registered → no outbox row

    uow.track(thing)
    await uow.commit()

    count = await session.execute(text("SELECT count(*) FROM messaging.outbox"))
    assert count.scalar_one() == 0
