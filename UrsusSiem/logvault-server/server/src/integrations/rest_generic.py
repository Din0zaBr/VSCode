"""URSUS SIEM - Generic REST API connector for arbitrary HTTP data sources."""
from __future__ import annotations

import json
import logging
from typing import Any

from .base import BaseIntegration

logger = logging.getLogger("server.integrations.rest_generic")


class GenericRESTConnector(BaseIntegration):
    """Configurable HTTP REST connector for any JSON-returning API."""

    name = "rest-generic"
    vendor = "Generic"
    category = "rest"

    def configure(self, **kwargs: Any) -> None:
        """
        Required kwargs:
          url         - API endpoint URL (may include {since} / {limit} placeholders)
          auth_type   - none | api_key | basic | bearer
          api_key     - API key value (for api_key / bearer)
          username    - (for basic)
          password    - (for basic)
          events_path - dot-separated JSON path to events array (e.g. "data.items")
          field_map   - dict mapping URSUS field names to source field names
          method      - GET or POST (default GET)
          body        - JSON body template for POST requests
        """
        self._config = kwargs
        self._configured = True

    def _headers(self) -> dict:
        headers: dict = {"Content-Type": "application/json", "Accept": "application/json"}
        auth = self._config.get("auth_type", "none")
        if auth == "api_key":
            key_header = self._config.get("api_key_header", "X-Api-Key")
            headers[key_header] = self._config.get("api_key", "")
        elif auth == "bearer":
            headers["Authorization"] = f"Bearer {self._config.get('api_key', '')}"
        elif auth == "basic":
            import base64
            creds = base64.b64encode(
                f"{self._config.get('username', '')}:{self._config.get('password', '')}".encode()
            ).decode()
            headers["Authorization"] = f"Basic {creds}"
        return headers

    def _build_url(self, since: str = "", limit: int = 1000) -> str:
        url = self._config.get("url", "")
        return url.replace("{since}", since).replace("{limit}", str(limit))

    def connect(self) -> bool:
        try:
            import urllib.request
            req = urllib.request.Request(self._config.get("url", "").split("?")[0], headers=self._headers())
            urllib.request.urlopen(req, timeout=5)
            self._connected = True
            return True
        except Exception as exc:
            logger.warning("GenericREST connect failed: %s", exc)
            return False

    def disconnect(self) -> None:
        self._connected = False

    def health_check(self) -> dict:
        ok = self.connect()
        return {"status": "ok" if ok else "unreachable", "url": self._config.get("url", "")}

    def pull_events(self, since: str = "", limit: int = 1000) -> list[dict]:
        import urllib.request

        url = self._build_url(since=since, limit=limit)
        method = self._config.get("method", "GET").upper()
        body_template = self._config.get("body", None)

        try:
            data = None
            if method == "POST" and body_template:
                raw_body = body_template
                if isinstance(raw_body, dict):
                    raw_body = json.dumps(raw_body)
                raw_body = raw_body.replace("{since}", since).replace("{limit}", str(limit))
                data = raw_body.encode()

            req = urllib.request.Request(url, data=data, headers=self._headers(), method=method)
            with urllib.request.urlopen(req, timeout=15) as r:
                response = json.loads(r.read())
        except Exception as exc:
            logger.error("GenericREST pull_events failed: %s", exc)
            return []

        # Navigate to events list via dot-separated path
        events_path = self._config.get("events_path", "")
        data_obj = response
        if events_path:
            for key in events_path.split("."):
                if isinstance(data_obj, dict):
                    data_obj = data_obj.get(key, [])
                else:
                    break

        if not isinstance(data_obj, list):
            data_obj = [data_obj] if data_obj else []

        return [self._map_event(e) for e in data_obj[:limit]]

    def _map_event(self, raw: dict) -> dict:
        field_map: dict = self._config.get("field_map", {})

        def get(ursus_field: str, default: str = "") -> str:
            src_field = field_map.get(ursus_field, ursus_field)
            val = raw.get(src_field, raw.get(ursus_field, default))
            return str(val) if val is not None else default

        return {
            "source": self._config.get("name", "rest-generic"),
            "timestamp": get("timestamp") or get("time") or get("ts"),
            "message": get("message") or get("msg") or str(raw),
            "host": get("host") or get("hostname"),
            "level": get("level") or get("severity") or "INFO",
            "service": get("service") or get("app"),
            "agent_id": get("agent_id"),
            "raw": raw,
        }
