from __future__ import annotations

from typing import TYPE_CHECKING, TypeVar

from adaptix import Retort

from ursus.application.common.events.integration_event import EventEnvelope

if TYPE_CHECKING:
    from ursus.application.common.events.integration_event import IntegrationEvent

EventT = TypeVar("EventT", bound="IntegrationEvent")


class IntegrationEventSerializer:
    def __init__(self) -> None:
        self._retort = Retort()

    def to_envelope(self, event: IntegrationEvent) -> EventEnvelope:
        return EventEnvelope(
            event_id=event.event_id,
            event_type=type(event).event_type,
            schema_version=type(event).schema_version,
            occurred_at=event.occurred_at,
            payload=self._retort.dump(event, type(event)),
        )

    def from_payload(
        self, payload: dict[str, object], event_cls: type[EventT]
    ) -> EventT:
        return self._retort.load(payload, event_cls)
