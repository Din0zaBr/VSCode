from __future__ import annotations

from typing import TYPE_CHECKING

from ursus.application.common.ports.unit_of_work import UnitOfWork

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from ursus.application.common.ports.outbox import OutboxStore
    from ursus.domain.common.aggregate_root import AggregateRoot
    from ursus.infrastructure.event_bus.serializer import IntegrationEventSerializer
    from ursus.infrastructure.mappers.registry import IntegrationEventRegistry


class SqlAlchemyUnitOfWork(UnitOfWork):
    def __init__(
        self,
        session: AsyncSession,
        outbox: OutboxStore,
        registry: IntegrationEventRegistry,
        serializer: IntegrationEventSerializer,
    ) -> None:
        self._session = session
        self._outbox = outbox
        self._registry = registry
        self._serializer = serializer
        self._tracked: list[AggregateRoot] = []

    def track(self, aggregate: AggregateRoot) -> None:
        self._tracked.append(aggregate)

    async def commit(self) -> None:
        await self._drain_events()
        await self._session.commit()
        self._tracked.clear()

    async def rollback(self) -> None:
        await self._session.rollback()
        self._tracked.clear()

    async def _drain_events(self) -> None:
        for aggregate in self._tracked:
            for domain_event in aggregate.collect_events():
                integration_event = self._registry.translate(domain_event)
                if integration_event is None:
                    continue
                envelope = self._serializer.to_envelope(integration_event)
                await self._outbox.add(envelope)
