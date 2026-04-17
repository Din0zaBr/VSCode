"""URSUS SIEM - ML Anomaly Detection integration."""
from __future__ import annotations

import json
import logging
from typing import Any

from .base import BaseIntegration

logger = logging.getLogger("server.integrations.ml_anomaly")


class MLAnomalyDetector(BaseIntegration):
    """Integration with an external ML anomaly detection REST service."""

    name = "ml-anomaly"
    vendor = "Custom ML"
    category = "ml"

    def configure(self, **kwargs: Any) -> None:
        """Configure with url, api_key, threshold (0.0-1.0)."""
        self._config = kwargs
        self._configured = True

    def _base_url(self) -> str:
        return self._config.get("url", "http://localhost:5000").rstrip("/")

    def _headers(self) -> dict:
        headers: dict = {"Content-Type": "application/json"}
        api_key = self._config.get("api_key", "")
        if api_key:
            headers["X-Api-Key"] = api_key
        return headers

    def connect(self) -> bool:
        try:
            import urllib.request
            req = urllib.request.Request(f"{self._base_url()}/health", headers=self._headers())
            urllib.request.urlopen(req, timeout=5)
            self._connected = True
            return True
        except Exception as exc:
            logger.warning("ML service connect failed: %s", exc)
            return False

    def disconnect(self) -> None:
        self._connected = False

    def health_check(self) -> dict:
        try:
            import urllib.request
            req = urllib.request.Request(f"{self._base_url()}/health", headers=self._headers())
            with urllib.request.urlopen(req, timeout=5) as r:
                data = json.loads(r.read())
            self._connected = True
            return {"status": "ok", "model": data.get("model", "unknown"), "version": data.get("version")}
        except Exception as exc:
            self._connected = False
            return {"status": "unreachable", "error": str(exc)}

    def score_events(self, events: list[dict]) -> list[dict]:
        """Send events to ML service and return anomaly scores."""
        if not events:
            return []
        try:
            import urllib.request
            body = json.dumps({"events": events}).encode()
            req = urllib.request.Request(
                f"{self._base_url()}/score",
                data=body,
                headers=self._headers(),
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=30) as r:
                result = json.loads(r.read())
            return result.get("scores", [])
        except Exception as exc:
            logger.error("ML score_events failed: %s", exc)
            return []

    def pull_events(self, since: str = "", limit: int = 1000) -> list[dict]:
        """Pull high-anomaly-score events from ML service."""
        threshold = float(self._config.get("threshold", 0.7))
        try:
            import urllib.request
            import urllib.parse
            params = urllib.parse.urlencode({"threshold": threshold, "limit": limit, "since": since})
            req = urllib.request.Request(
                f"{self._base_url()}/anomalies?{params}",
                headers=self._headers(),
            )
            with urllib.request.urlopen(req, timeout=10) as r:
                data = json.loads(r.read())
            results = data if isinstance(data, list) else data.get("anomalies", [])
            return [self._map_anomaly(a) for a in results]
        except Exception as exc:
            logger.error("ML pull_events failed: %s", exc)
            return []

    def _map_anomaly(self, raw: dict) -> dict:
        score = raw.get("score", 0.0)
        return {
            "source": "ml-anomaly",
            "timestamp": raw.get("timestamp", ""),
            "message": raw.get("description", f"ML anomaly score={score:.2f}"),
            "host": raw.get("host", ""),
            "level": "CRITICAL" if score >= 0.9 else "ERROR" if score >= 0.7 else "WARNING",
            "service": raw.get("service", ""),
            "agent_id": raw.get("agent_id", ""),
            "score": score,
            "raw": raw,
        }
