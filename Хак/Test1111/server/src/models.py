from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class LogEvent(BaseModel):
    event_id: str = ""
    timestamp: str = ""
    host: str = ""
    agent_id: str = ""
    source: str = ""
    level: str = "INFO"
    message: str = ""
    service: str = ""
    meta: dict[str, Any] = Field(default_factory=dict)


class IngestRequest(BaseModel):
    agent_id: str
    api_key: str
    logs: list[LogEvent]


class IngestResponse(BaseModel):
    ok: bool
    indexed: int = 0
    errors: int = 0


class SearchRequest(BaseModel):
    q: str = ""
    level: str = ""
    agent_id: str = ""
    service: str = ""
    from_ts: str = ""
    to_ts: str = ""
    page: int = 1
    size: int = 50


class AlertRule(BaseModel):
    id: str = ""
    name: str = ""
    enabled: bool = True
    condition_type: str = "threshold"  # threshold | regex
    threshold: int = 10
    window_minutes: int = 5
    regex_pattern: str = ""
    level: str = "ERROR"
    channels: list[AlertChannel] = Field(default_factory=list)


class AlertChannel(BaseModel):
    type: str = "webhook"  # webhook | telegram
    webhook_url: str = ""
    telegram_token: str = ""
    telegram_chat_id: str = ""


AlertRule.model_rebuild()


class StatsQuery(BaseModel):
    interval: str = "1h"
    from_ts: str = ""
    to_ts: str = ""
    agent_id: str = ""
    service: str = ""
