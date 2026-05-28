from __future__ import annotations

from dataclasses import dataclass
from typing import Self
from uuid import UUID, uuid4


@dataclass(frozen=True, slots=True)
class EntityId:
    value: UUID

    @classmethod
    def generate(cls) -> Self:
        return cls(uuid4())

    def __str__(self) -> str:
        return str(self.value)
