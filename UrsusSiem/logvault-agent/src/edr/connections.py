"""Network-connection telemetry — periodic netstat-like snapshot."""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterator

try:
    import psutil  # type: ignore
except ImportError:
    psutil = None  # type: ignore

log = logging.getLogger(__name__)


@dataclass
class ConnectionReader:
    interval_seconds: int = 60
    agent_id: str = "edr"

    def __post_init__(self) -> None:
        if psutil is None:
            raise RuntimeError("psutil not installed")

    def read(self) -> Iterator[dict]:
        while True:
            yield from self._tick()
            time.sleep(self.interval_seconds)

    def _tick(self) -> Iterator[dict]:
        try:
            conns = psutil.net_connections(kind="inet")
        except (psutil.AccessDenied, OSError) as e:
            log.warning("net_connections: %s", e)
            return

        host = os.uname().nodename if hasattr(os, "uname") else os.environ.get("COMPUTERNAME", "")
        now = datetime.now(timezone.utc).isoformat()

        for c in conns:
            if c.status not in ("ESTABLISHED", "LISTEN", "SYN_SENT"):
                continue
            laddr = c.laddr.ip if c.laddr else ""
            lport = c.laddr.port if c.laddr else 0
            raddr = c.raddr.ip if c.raddr else ""
            rport = c.raddr.port if c.raddr else 0
            yield {
                "timestamp": now,
                "source": "edr",
                "agent_id": self.agent_id,
                "host": host,
                "level": "info",
                "service": "net_monitor",
                "message": f"{c.status} {laddr}:{lport} -> {raddr}:{rport} (pid {c.pid})",
                "meta": {
                    "category": "network",
                    "ocsf.class_uid": 4001,
                    "src.ip": laddr, "src.port": lport,
                    "dst.ip": raddr, "dst.port": rport,
                    "proto": "tcp" if c.type == 1 else "udp",
                    "status": c.status,
                    "process.pid": c.pid,
                },
            }
