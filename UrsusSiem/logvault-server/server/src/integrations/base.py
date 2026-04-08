"""
URSUS SIEM - Base integration interface for security products.
All vendor integrations inherit from BaseIntegration.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any
import logging

logger = logging.getLogger("server.integrations")


class BaseIntegration(ABC):
    """Base class for all integrations."""

    name: str = "unknown"
    vendor: str = "unknown"
    category: str = "unknown"  # edr, siem, firewall, av, dlp, soar, sandbox, nta, syslog, cef

    def __init__(self) -> None:
        self._configured = False
        self._connected = False
        self._config: dict[str, Any] = {}

    @abstractmethod
    def configure(self, **kwargs: Any) -> None:
        """Configure the integration."""

    @abstractmethod
    def connect(self) -> bool:
        """Connect to the product."""

    @abstractmethod
    def disconnect(self) -> None:
        """Disconnect."""

    @abstractmethod
    def health_check(self) -> dict:
        """Check availability."""

    def get_status(self) -> dict:
        return {
            "name": self.name,
            "vendor": self.vendor,
            "category": self.category,
            "configured": self._configured,
            "connected": self._connected,
        }

    def pull_events(self, since: str = "", limit: int = 1000) -> list[dict]:
        return []

    def push_event(self, event: dict) -> bool:
        return False

    def pull_ioc(self) -> list[dict]:
        return []

    def create_incident(self, data: dict) -> dict | None:
        return None

    def quarantine_host(self, host: str) -> bool:
        return False

    def block_ip(self, ip: str) -> bool:
        return False


class IntegrationRegistry:
    """Registry of all connected integrations."""

    def __init__(self) -> None:
        self._integrations: dict[str, BaseIntegration] = {}

    def register(self, integration: BaseIntegration) -> None:
        self._integrations[integration.name] = integration
        logger.info("Integration registered: %s (%s)", integration.name, integration.vendor)

    def get(self, name: str) -> BaseIntegration | None:
        return self._integrations.get(name)

    def list_all(self) -> list[dict]:
        return [i.get_status() for i in self._integrations.values()]

    def list_by_category(self, category: str) -> list[dict]:
        return [i.get_status() for i in self._integrations.values() if i.category == category]
