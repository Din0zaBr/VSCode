from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ursus.application.common.events.integration_event import EventEnvelope


class OutboxStore(ABC):
    @abstractmethod
    async def add(self, envelope: EventEnvelope) -> None: ...
