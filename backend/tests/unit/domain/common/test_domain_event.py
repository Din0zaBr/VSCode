from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from ursus.domain.common.domain_event import DomainEvent


def test_event_has_a_uuid_and_aware_timestamp() -> None:
    event = DomainEvent()
    assert isinstance(event.event_id, UUID)
    assert event.occurred_at.tzinfo is not None


def test_distinct_events_have_distinct_ids() -> None:
    assert DomainEvent().event_id != DomainEvent().event_id


def test_subclasses_can_add_payload_fields() -> None:
    @dataclass(frozen=True)
    class _ThingHappened(DomainEvent):
        thing_id: str

    event = _ThingHappened(thing_id="abc")
    assert event.thing_id == "abc"
    assert isinstance(event.event_id, UUID)
