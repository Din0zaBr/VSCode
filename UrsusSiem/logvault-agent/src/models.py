from __future__ import annotations

import hashlib
import socket
import time
import uuid
from typing import Any

from pydantic import BaseModel, Field


def _generate_event_id(timestamp: str, source: str, message: str) -> str:
    raw = f"{timestamp}:{source}:{message}"
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


class LogEvent(BaseModel):
    event_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:24])
    timestamp: str
    host: str = Field(default_factory=socket.gethostname)
    agent_id: str = ""
    source: str = ""
    level: str = "INFO"
    message: str = ""
    service: str = ""
    meta: dict[str, Any] = Field(default_factory=dict)

    def with_event_id(self) -> LogEvent:
        self.event_id = _generate_event_id(self.timestamp, self.source, self.message)
        return self


class IngestBatch(BaseModel):
    agent_id: str
    api_key: str
    logs: list[LogEvent]
