from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ursus.domain.common.aggregate_root import AggregateRoot


class UnitOfWork(ABC):
    @abstractmethod
    def track(self, aggregate: AggregateRoot) -> None: ...

    @abstractmethod
    async def commit(self) -> None: ...

    @abstractmethod
    async def rollback(self) -> None: ...
