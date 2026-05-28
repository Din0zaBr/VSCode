from __future__ import annotations

from dataclasses import FrozenInstanceError, dataclass

import pytest

from ursus.domain.common.value_object import ValueObject


@dataclass(frozen=True)
class _Money(ValueObject):
    amount: int
    currency: str


def test_value_objects_are_equal_by_value() -> None:
    assert _Money(100, "USD") == _Money(100, "USD")


def test_value_objects_differ_when_fields_differ() -> None:
    assert _Money(100, "USD") != _Money(100, "EUR")


def test_value_objects_are_immutable() -> None:
    money = _Money(100, "USD")
    with pytest.raises(FrozenInstanceError):
        money.amount = 200  # type: ignore[misc]
