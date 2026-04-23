"""URSUS SIEM - Elasticsearch / OpenSearch integration."""
from __future__ import annotations

import json
import logging
from typing import Any
from datetime import datetime, timedelta, timezone

from .base import BaseIntegration

logger = logging.getLogger("server.integrations.elastic")


class ElasticIntegration(BaseIntegration):
    name = "elastic"
    vendor = "Elastic"
    category = "siem"

    def configure(self, **kwargs: Any) -> None:
        """Configure with url, index, api_key or username+password."""
        self._config = kwargs
        self._configured = True

    def _base_url(self) -> str:
        return self._config.get("url", "http://localhost:9200").rstrip("/")

    def _headers(self) -> dict:
        headers: dict = {"Content-Type": "application/json"}
        api_key = self._config.get("api_key", "")
        username = self._config.get("username", "")
        password = self._config.get("password", "")
        if api_key:
            headers["Authorization"] = f"ApiKey {api_key}"
        elif username:
            import base64
            token = base64.b64encode(f"{username}:{password}".encode()).decode()
            headers["Authorization"] = f"Basic {token}"
        return headers

    def connect(self) -> bool:
        try:
            import urllib.request
            req = urllib.request.Request(f"{self._base_url()}/", headers=self._headers())
            urllib.request.urlopen(req, timeout=5)
            self._connected = True
            return True
        except Exception as exc:
            logger.warning("Elastic connect failed: %s", exc)
            return False

    def disconnect(self) -> None:
        self._connected = False

    def health_check(self) -> dict:
        try:
            import urllib.request
            req = urllib.request.Request(f"{self._base_url()}/_cluster/health", headers=self._headers())
            with urllib.request.urlopen(req, timeout=5) as r:
                data = json.loads(r.read())
            self._connected = True
            return {"status": data.get("status", "unknown"), "cluster": data.get("cluster_name")}
        except Exception as exc:
            self._connected = False
            return {"status": "unreachable", "error": str(exc)}

    def pull_events(self, since: str = "", limit: int = 1000) -> list[dict]:
        """Query logs from Elasticsearch index."""
        index = self._config.get("index", "logs-*")
        if not since:
            since = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()

        query = {
            "size": limit,
            "sort": [{"@timestamp": {"order": "desc"}}],
            "query": {"range": {"@timestamp": {"gte": since}}},
        }
        try:
            import urllib.request
            body = json.dumps(query).encode()
            req = urllib.request.Request(
                f"{self._base_url()}/{index}/_search",
                data=body,
                headers=self._headers(),
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.loads(r.read())
            hits = data.get("hits", {}).get("hits", [])
            return [self._map_hit(h) for h in hits]
        except Exception as exc:
            logger.error("Elastic pull_events failed: %s", exc)
            return []

    def _map_hit(self, hit: dict) -> dict:
        src = hit.get("_source", {})
        return {
            "source": "elastic",
            "timestamp": src.get("@timestamp", ""),
            "message": src.get("message", str(src)),
            "host": src.get("host", {}).get("name", src.get("host", "")),
            "level": src.get("log", {}).get("level", "INFO").upper(),
            "service": src.get("service", {}).get("name", ""),
            "agent_id": src.get("agent", {}).get("id", ""),
            "raw": src,
        }
