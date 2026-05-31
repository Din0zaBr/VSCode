from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from uuid import UUID


class InboxStore(ABC):
    @abstractmethod
    async def seen(self, event_id: UUID) -> bool: ...

    @abstractmethod
    async def mark_processed(self, event_id: UUID) -> None: ...
