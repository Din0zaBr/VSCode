from __future__ import annotations

from dataclasses import dataclass

from ursus.application.common.events.integration_event import IntegrationEvent
from ursus.domain.common.domain_event import DomainEvent
from ursus.infrastructure.mappers.registry import IntegrationEventRegistry


@dataclass(frozen=True, kw_only=True)
class ThingDone(DomainEvent):
    thing_id: str


@dataclass(frozen=True, kw_only=True)
class ThingDoneIntegration(IntegrationEvent):
    event_type = "test.thing_done"
    schema_version = 1
    thing_id: str


def _translate(event: DomainEvent) -> IntegrationEvent:
    assert isinstance(event, ThingDone)
    return ThingDoneIntegration(
        event_id=event.event_id,
        occurred_at=event.occurred_at,
        thing_id=event.thing_id,
    )


def test_registered_event_is_translated() -> None:
    registry = IntegrationEventRegistry()
    registry.register(ThingDone, _translate)
    domain_event = ThingDone(thing_id="abc")
    result = registry.translate(domain_event)
    assert isinstance(result, ThingDoneIntegration)
    assert result.event_id == domain_event.event_id
    assert result.thing_id == "abc"


def test_unregistered_event_returns_none() -> None:
    registry = IntegrationEventRegistry()
    assert registry.translate(ThingDone(thing_id="abc")) is None
