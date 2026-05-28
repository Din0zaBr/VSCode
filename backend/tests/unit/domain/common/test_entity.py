from __future__ import annotations

from ursus.domain.common.entity import Entity
from ursus.domain.common.entity_id import EntityId


class _Operator(Entity):
    pass


class _Incident(Entity):
    pass


def test_entities_with_same_id_and_type_are_equal() -> None:
    entity_id = EntityId.generate()
    assert _Operator(entity_id) == _Operator(entity_id)


def test_entities_with_different_ids_are_not_equal() -> None:
    assert _Operator(EntityId.generate()) != _Operator(EntityId.generate())


def test_entities_of_different_types_with_same_id_are_not_equal() -> None:
    entity_id = EntityId.generate()
    assert _Operator(entity_id) != _Incident(entity_id)


def test_entity_is_hashable_by_id_and_type() -> None:
    entity_id = EntityId.generate()
    assert hash(_Operator(entity_id)) == hash(_Operator(entity_id))


def test_id_property_returns_the_identity() -> None:
    entity_id = EntityId.generate()
    assert _Operator(entity_id).id == entity_id
