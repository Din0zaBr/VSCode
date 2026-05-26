from __future__ import annotations

import abc

from agent.src.models import LogEvent


class Transport(abc.ABC):
    """Abstract transport layer. Swap HTTP for Kafka/NATS to move to Variant B."""

    @abc.abstractmethod
    def send(self, batch: list[LogEvent]) -> bool:
        """Send a batch of events. Returns True on success."""

    @abc.abstractmethod
    def close(self) -> None:
        """Release resources."""
