"""URSUS SIEM - Generic Syslog receiver integration (stub)."""
from __future__ import annotations
from typing import Any
from .base import BaseIntegration


class SyslogReceiver(BaseIntegration):
    name = "syslog-receiver"
    vendor = "Generic"
    category = "syslog"

    def configure(self, **kwargs: Any) -> None:
        self._config = kwargs
        self._configured = True

    def connect(self) -> bool:
        # TODO: UDP/TCP syslog listener
        return False

    def disconnect(self) -> None:
        self._connected = False

    def health_check(self) -> dict:
        return {"status": "not_implemented"}
