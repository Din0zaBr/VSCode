from __future__ import annotations

from uuid import UUID, uuid4

from ursus.domain.common.entity_id import EntityId


def test_entity_ids_with_same_value_are_equal() -> None:
    # Arrange
    value = uuid4()
    # Act / Assert
    assert EntityId(value) == EntityId(value)


def test_entity_ids_with_different_values_are_not_equal() -> None:
    assert EntityId(uuid4()) != EntityId(uuid4())


def test_generate_produces_unique_ids() -> None:
    assert EntityId.generate() != EntityId.generate()


def test_str_returns_the_uuid_string() -> None:
    value = uuid4()
    assert str(EntityId(value)) == str(value)


def test_value_is_a_uuid() -> None:
    assert isinstance(EntityId.generate().value, UUID)
