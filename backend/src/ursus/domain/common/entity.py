from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ursus.domain.common.entity_id import EntityId


class Entity:
    def __init__(self, entity_id: EntityId) -> None:
        self._id = entity_id

    @property
    def id(self) -> EntityId:
        return self._id

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Entity):
            return NotImplemented
        return type(self) is type(other) and self._id == other._id

    def __hash__(self) -> int:
        return hash((type(self), self._id))
