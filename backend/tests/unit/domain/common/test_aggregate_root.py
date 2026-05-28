from __future__ import annotations

from ursus.domain.common.aggregate_root import AggregateRoot
from ursus.domain.common.domain_event import DomainEvent
from ursus.domain.common.entity_id import EntityId


def test_records_and_collects_events_in_order() -> None:
    aggregate = AggregateRoot(EntityId.generate())
    first = DomainEvent()
    second = DomainEvent()
    aggregate.record_event(first)
    aggregate.record_event(second)
    assert aggregate.collect_events() == [first, second]


def test_collect_clears_recorded_events() -> None:
    aggregate = AggregateRoot(EntityId.generate())
    aggregate.record_event(DomainEvent())
    aggregate.collect_events()
    assert aggregate.collect_events() == []


def test_aggregate_root_is_an_entity() -> None:
    entity_id = EntityId.generate()
    assert AggregateRoot(entity_id).id == entity_id
