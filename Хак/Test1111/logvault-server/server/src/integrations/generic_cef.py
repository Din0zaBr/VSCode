"""URSUS SIEM - Generic CEF receiver integration (stub)."""
from __future__ import annotations
from typing import Any
from .base import BaseIntegration


class CEFReceiver(BaseIntegration):
    name = "cef-receiver"
    vendor = "Generic"
    category = "cef"

    def configure(self, **kwargs: Any) -> None:
        self._config = kwargs
        self._configured = True

    def connect(self) -> bool:
        # TODO: CEF format (ArcSight, etc.)
        return False

    def disconnect(self) -> None:
        self._connected = False

    def health_check(self) -> dict:
        return {"status": "not_implemented"}
