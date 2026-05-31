from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from ursus.application.common.events.integration_event import (
    EventEnvelope,
    IntegrationEvent,
)


@dataclass(frozen=True, kw_only=True)
class ThingHappened(IntegrationEvent):
    event_type = "test.thing_happened"
    schema_version = 1
    thing_id: str


def test_integration_event_carries_type_and_version_as_class_metadata() -> None:
    assert ThingHappened.event_type == "test.thing_happened"
    assert ThingHappened.schema_version == 1


def test_integration_event_instance_has_id_and_timestamp() -> None:
    event = ThingHappened(
        event_id=uuid4(),
        occurred_at=datetime.now(UTC),
        thing_id="abc",
    )
    assert event.thing_id == "abc"


def test_event_envelope_is_constructible() -> None:
    envelope = EventEnvelope(
        event_id=uuid4(),
        event_type="test.thing_happened",
        schema_version=1,
        occurred_at=datetime.now(UTC),
        payload={"thing_id": "abc"},
    )
    assert envelope.payload == {"thing_id": "abc"}
