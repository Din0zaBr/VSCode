"""URSUS SIEM - Generic Webhook Receiver integration."""
from __future__ import annotations

import json
import logging
from collections import deque
from typing import Any

from .base import BaseIntegration

logger = logging.getLogger("server.integrations.webhook")

# In-memory ring buffer for received webhook payloads
_webhook_queue: deque[dict] = deque(maxlen=10_000)


def push_webhook_event(payload: dict, source_name: str = "webhook") -> None:
    """Called by the webhook endpoint to enqueue an incoming event."""
    _webhook_queue.appendleft({**payload, "_webhook_source": source_name})


class WebhookReceiver(BaseIntegration):
    """Receives inbound webhook payloads from external systems."""

    name = "webhook-receiver"
    vendor = "Generic"
    category = "webhook"

    def configure(self, **kwargs: Any) -> None:
        """Configure with secret (optional HMAC verification) and field_map."""
        self._config = kwargs
        self._configured = True

    def connect(self) -> bool:
        self._connected = True
        return True

    def disconnect(self) -> None:
        self._connected = False

    def health_check(self) -> dict:
        return {"status": "ok", "queue_size": len(_webhook_queue), "maxlen": _webhook_queue.maxlen}

    def pull_events(self, since: str = "", limit: int = 1000) -> list[dict]:
        """Drain the webhook queue and return mapped events."""
        events: list[dict] = []
        while _webhook_queue and len(events) < limit:
            raw = _webhook_queue.pop()
            events.append(self._map_event(raw))
        return events

    def _map_event(self, raw: dict) -> dict:
        field_map: dict = self._config.get("field_map", {})
        def get(key: str, default: str = "") -> str:
            mapped = field_map.get(key, key)
            return str(raw.get(mapped, raw.get(key, default)))

        return {
            "source": raw.get("_webhook_source", "webhook"),
            "timestamp": get("timestamp") or get("time") or get("ts"),
            "message": get("message") or get("msg") or get("description") or str(raw),
            "host": get("host") or get("hostname"),
            "level": get("level") or get("severity") or "INFO",
            "service": get("service") or get("app"),
            "agent_id": get("agent_id"),
            "raw": raw,
        }
