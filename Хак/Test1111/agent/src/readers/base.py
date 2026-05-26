from __future__ import annotations

import abc
from typing import Generator

from agent.src.models import LogEvent


class LogReader(abc.ABC):
    """Base class for all log readers."""

    def __init__(self, source: str, service: str) -> None:
        self.source = source
        self.service = service

    @abc.abstractmethod
    def read(self) -> Generator[LogEvent, None, None]:
        """Yield new log events as they appear. Must be non-blocking or use short sleeps."""

    @abc.abstractmethod
    def close(self) -> None:
        """Release resources."""
