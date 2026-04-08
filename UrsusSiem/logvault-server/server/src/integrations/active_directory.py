"""
URSUS SIEM - Active Directory Integration (stub).
Uses ldap3 (optional dependency).
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("server.ad")


class ADConnector:
    """Interface for Active Directory operations."""

    def __init__(self) -> None:
        self._connected = False
        self._config: dict[str, Any] = {}
        logger.info("AD Connector initialized (not configured)")

    def configure(self, server: str, domain: str, username: str, password: str,
                  base_dn: str, use_ssl: bool = True, port: int = 636) -> None:
        self._config = {
            "server": server, "domain": domain, "username": username,
            "password": password, "base_dn": base_dn, "use_ssl": use_ssl, "port": port,
        }
        logger.info("AD configured: %s (domain=%s)", server, domain)

    def connect(self) -> bool:
        """TODO: Connect via ldap3. pip install ldap3"""
        logger.warning("AD connect: not implemented (install ldap3)")
        return False

    def disconnect(self) -> None:
        self._connected = False

    def sync_users(self) -> list[dict]:
        """TODO: Fetch users from AD."""
        return []

    def sync_groups(self) -> list[dict]:
        """TODO: Fetch groups from AD."""
        return []

    def sync_computers(self) -> list[dict]:
        """TODO: Fetch computers from AD (for assets)."""
        return []

    def authenticate(self, username: str, password: str) -> dict | None:
        """TODO: Authenticate user via AD (LDAP bind)."""
        return None

    def search_users(self, query: str, limit: int = 50) -> list[dict]:
        """TODO: Search users in AD."""
        return []

    def get_user_groups(self, username: str) -> list[str]:
        """TODO: Get user groups."""
        return []

    def get_status(self) -> dict:
        return {
            "configured": bool(self._config),
            "connected": self._connected,
            "server": self._config.get("server", ""),
            "domain": self._config.get("domain", ""),
        }
