"""URSUS SIEM - Kaspersky EDR integration (stub)."""
from __future__ import annotations
from typing import Any
from .base import BaseIntegration


class KasperskyEDR(BaseIntegration):
    name = "kaspersky-edr"
    vendor = "Kaspersky"
    category = "edr"

    def configure(self, **kwargs: Any) -> None:
        self._config = kwargs
        self._configured = True

    def connect(self) -> bool:
        # TODO: API Kaspersky EDR Expert / KATA
        return False

    def disconnect(self) -> None:
        self._connected = False

    def health_check(self) -> dict:
        return {"status": "not_implemented"}
