"""URSUS SIEM - Splunk integration via REST API."""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from .base import BaseIntegration

logger = logging.getLogger("server.integrations.splunk")


class SplunkIntegration(BaseIntegration):
    name = "splunk"
    vendor = "Splunk"
    category = "siem"

    def configure(self, **kwargs: Any) -> None:
        """Configure with url, token (Splunk HEC/REST token), and index."""
        self._config = kwargs
        self._configured = True

    def _base_url(self) -> str:
        return self._config.get("url", "https://localhost:8089").rstrip("/")

    def _headers(self) -> dict:
        token = self._config.get("token", "")
        return {"Authorization": f"Splunk {token}", "Content-Type": "application/json"}

    def connect(self) -> bool:
        try:
            import urllib.request
            import ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            req = urllib.request.Request(f"{self._base_url()}/services/server/info?output_mode=json", headers=self._headers())
            urllib.request.urlopen(req, timeout=5, context=ctx)
            self._connected = True
            return True
        except Exception as exc:
            logger.warning("Splunk connect failed: %s", exc)
            return False

    def disconnect(self) -> None:
        self._connected = False

    def health_check(self) -> dict:
        try:
            import urllib.request
            import ssl
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            req = urllib.request.Request(f"{self._base_url()}/services/server/health?output_mode=json", headers=self._headers())
            with urllib.request.urlopen(req, timeout=5, context=ctx) as r:
                data = json.loads(r.read())
            self._connected = True
            return {"status": "ok", "health": data.get("entry", [{}])[0].get("content", {})}
        except Exception as exc:
            self._connected = False
            return {"status": "unreachable", "error": str(exc)}

    def pull_events(self, since: str = "", limit: int = 1000) -> list[dict]:
        """Run Splunk search job and fetch results."""
        import urllib.request
        import urllib.parse
        import ssl

        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        index = self._config.get("index", "main")
        spl = f'search index={index} | head {limit}'
        if since:
            spl += f' earliest="{since}"'

        # Create search job
        try:
            body = urllib.parse.urlencode({"search": spl, "output_mode": "json"}).encode()
            req = urllib.request.Request(f"{self._base_url()}/services/search/jobs", data=body, headers=self._headers())
            with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
                job = json.loads(r.read())
            sid = job.get("sid")
            if not sid:
                return []
        except Exception as exc:
            logger.error("Splunk create job failed: %s", exc)
            return []

        # Poll for job completion
        for _ in range(20):
            try:
                req = urllib.request.Request(f"{self._base_url()}/services/search/jobs/{sid}?output_mode=json", headers=self._headers())
                with urllib.request.urlopen(req, timeout=5, context=ctx) as r:
                    status = json.loads(r.read())
                done = status.get("entry", [{}])[0].get("content", {}).get("isDone", False)
                if done:
                    break
                time.sleep(0.5)
            except Exception:
                break

        # Fetch results
        try:
            req = urllib.request.Request(f"{self._base_url()}/services/search/jobs/{sid}/results?output_mode=json&count={limit}", headers=self._headers())
            with urllib.request.urlopen(req, timeout=10, context=ctx) as r:
                result = json.loads(r.read())
            return [self._map_event(r) for r in result.get("results", [])]
        except Exception as exc:
            logger.error("Splunk fetch results failed: %s", exc)
            return []

    def _map_event(self, raw: dict) -> dict:
        return {
            "source": "splunk",
            "timestamp": raw.get("_time", ""),
            "message": raw.get("_raw", raw.get("message", str(raw))),
            "host": raw.get("host", ""),
            "level": raw.get("severity", raw.get("level", "INFO")).upper(),
            "service": raw.get("sourcetype", ""),
            "agent_id": "",
            "raw": raw,
        }
