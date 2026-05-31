from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from ursus.application.common.events.integration_event import IntegrationEvent
from ursus.infrastructure.event_bus.serializer import IntegrationEventSerializer


@dataclass(frozen=True, kw_only=True)
class ThingHappened(IntegrationEvent):
    event_type = "test.thing_happened"
    schema_version = 1
    thing_id: str


def test_to_envelope_extracts_routing_metadata() -> None:
    serializer = IntegrationEventSerializer()
    event = ThingHappened(
        event_id=uuid4(), occurred_at=datetime.now(UTC), thing_id="abc"
    )
    envelope = serializer.to_envelope(event)
    assert envelope.event_type == "test.thing_happened"
    assert envelope.schema_version == 1
    assert envelope.event_id == event.event_id
    assert envelope.payload["thing_id"] == "abc"


def test_from_payload_round_trips() -> None:
    serializer = IntegrationEventSerializer()
    event = ThingHappened(
        event_id=uuid4(), occurred_at=datetime.now(UTC), thing_id="abc"
    )
    envelope = serializer.to_envelope(event)
    restored = serializer.from_payload(envelope.payload, ThingHappened)
    assert restored == event


def test_from_payload_is_tolerant_to_unknown_fields() -> None:
    serializer = IntegrationEventSerializer()
    event = ThingHappened(
        event_id=uuid4(), occurred_at=datetime.now(UTC), thing_id="abc"
    )
    payload = {**serializer.to_envelope(event).payload, "added_in_v2": 99}
    restored = serializer.from_payload(payload, ThingHappened)
    assert restored == event
