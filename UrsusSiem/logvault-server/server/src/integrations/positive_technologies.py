"""URSUS SIEM - Positive Technologies integrations (stubs)."""
from __future__ import annotations
from typing import Any
from .base import BaseIntegration


class PTSandbox(BaseIntegration):
    name = "pt-sandbox"
    vendor = "Positive Technologies"
    category = "sandbox"

    def configure(self, **kwargs: Any) -> None:
        self._config = kwargs
        self._configured = True

    def connect(self) -> bool:
        return False

    def disconnect(self) -> None:
        self._connected = False

    def health_check(self) -> dict:
        return {"status": "not_implemented"}


class PTNAD(BaseIntegration):
    name = "pt-nad"
    vendor = "Positive Technologies"
    category = "nta"

    def configure(self, **kwargs: Any) -> None:
        self._config = kwargs
        self._configured = True

    def connect(self) -> bool:
        return False

    def disconnect(self) -> None:
        self._connected = False

    def health_check(self) -> dict:
        return {"status": "not_implemented"}
