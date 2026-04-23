"""URSUS SIEM - Suricata IDS integration."""
from __future__ import annotations

import json
import logging
import socket
from typing import Any

from .base import BaseIntegration

logger = logging.getLogger("server.integrations.suricata")


class SuricataIDS(BaseIntegration):
    name = "suricata"
    vendor = "OISF"
    category = "nta"

    def configure(self, **kwargs: Any) -> None:
        """Configure Suricata EVE JSON socket or REST endpoint."""
        self._config = kwargs
        self._configured = True

    def connect(self) -> bool:
        """Test connection to Suricata EVE socket or REST API."""
        eve_socket = self._config.get("eve_socket", "/var/run/suricata/suricata-command.socket")
        rest_url = self._config.get("rest_url", "")

        if rest_url:
            try:
                import urllib.request
                urllib.request.urlopen(f"{rest_url.rstrip('/')}/", timeout=3)
                self._connected = True
                return True
            except Exception as exc:
                logger.warning("Suricata REST connect failed: %s", exc)
                return False

        try:
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.settimeout(3)
            s.connect(eve_socket)
            s.close()
            self._connected = True
            return True
        except Exception as exc:
            logger.warning("Suricata socket connect failed: %s", exc)
            return False

    def disconnect(self) -> None:
        self._connected = False

    def health_check(self) -> dict:
        ok = self.connect()
        return {"status": "ok" if ok else "unreachable", "backend": self._config.get("rest_url") or self._config.get("eve_socket")}

    def pull_events(self, since: str = "", limit: int = 1000) -> list[dict]:
        """Pull alerts from Suricata EVE JSON log file or REST API."""
        events: list[dict] = []
        log_file = self._config.get("eve_log", "/var/log/suricata/eve.json")
        rest_url = self._config.get("rest_url", "")

        if rest_url:
            try:
                import urllib.request
                import urllib.parse
                params = urllib.parse.urlencode({"limit": limit})
                url = f"{rest_url.rstrip('/')}/alerts?{params}"
                with urllib.request.urlopen(url, timeout=5) as r:
                    data = json.loads(r.read())
                    raw_alerts = data if isinstance(data, list) else data.get("alerts", [])
                    for a in raw_alerts[:limit]:
                        events.append(self._map_alert(a))
            except Exception as exc:
                logger.error("Suricata REST pull failed: %s", exc)
            return events

        try:
            with open(log_file, encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
            for line in lines[-limit:]:
                try:
                    entry = json.loads(line)
                    if entry.get("event_type") == "alert":
                        events.append(self._map_alert(entry))
                except json.JSONDecodeError:
                    continue
        except FileNotFoundError:
            logger.warning("Suricata EVE log not found: %s", log_file)
        return events

    def _map_alert(self, raw: dict) -> dict:
        alert = raw.get("alert", {})
        return {
            "source": "suricata",
            "timestamp": raw.get("timestamp", ""),
            "src_ip": raw.get("src_ip", ""),
            "dst_ip": raw.get("dest_ip", ""),
            "src_port": raw.get("src_port"),
            "dst_port": raw.get("dest_port"),
            "protocol": raw.get("proto", ""),
            "message": alert.get("signature", "Suricata alert"),
            "category": alert.get("category", ""),
            "severity": alert.get("severity", 3),
            "signature_id": alert.get("signature_id"),
            "action": alert.get("action", ""),
            "level": "ERROR" if alert.get("severity", 3) <= 1 else "WARNING",
        }
