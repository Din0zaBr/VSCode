from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field


class SourceConfig(BaseModel):
    type: str  # "file" | "journald" | "winevent"
    path: str = ""
    unit: str = ""
    service: str = ""
    # winevent-specific fields
    channel: str = "System"          # Windows Event Log channel name
    event_ids: list[int] = Field(default_factory=list)  # filter by Event ID (empty = all)


class AgentConfig(BaseModel):
    server_url: str = "http://localhost:8000"
    agent_id: str = "agent-default"
    api_key: str = ""
    hostname: str = ""
    batch_size: int = 200
    flush_interval: float = 2.0
    retry_base: float = 1.0
    retry_max: float = 60.0
    buffer_db: str = "/data/buffer.db"
    verify_ssl: bool = True   # set false when server uses a self-signed certificate
    sources: list[SourceConfig] = Field(default_factory=list)


def load_config(path: str = "/etc/logvault/config.yaml") -> AgentConfig:
    p = Path(path)
    if not p.exists():
        return AgentConfig()
    raw: dict[str, Any] = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    return AgentConfig(**raw)
