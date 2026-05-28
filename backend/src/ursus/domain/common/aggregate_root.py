from __future__ import annotations

from typing import TYPE_CHECKING

from ursus.domain.common.entity import Entity

if TYPE_CHECKING:
    from ursus.domain.common.domain_event import DomainEvent
    from ursus.domain.common.entity_id import EntityId


class AggregateRoot(Entity):
    def __init__(self, entity_id: EntityId) -> None:
        super().__init__(entity_id)
        self._domain_events: list[DomainEvent] = []

    def record_event(self, event: DomainEvent) -> None:
        self._domain_events.append(event)

    def collect_events(self) -> list[DomainEvent]:
        events = list(self._domain_events)
        self._domain_events.clear()
        return events
