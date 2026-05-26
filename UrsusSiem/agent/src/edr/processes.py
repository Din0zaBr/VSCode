"""Process telemetry reader.

Walks /proc (Linux) or WMI Win32_Process (Windows) every N seconds via
the `psutil` cross-platform abstraction. Emits OCSF Process Activity
(class_uid 1007) events. We diff against the previous snapshot so only
new/disappeared processes generate events — keeps EPS reasonable.
"""
from __future__ import annotations

import hashlib
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterator

try:
    import psutil  # type: ignore
except ImportError:
    psutil = None  # type: ignore

log = logging.getLogger(__name__)


@dataclass
class ProcessReader:
    interval_seconds: int = 60
    hash_executables: bool = False  # off by default — slow on Windows
    agent_id: str = "edr"
    _last_pids: set[int] = field(default_factory=set)

    def __post_init__(self) -> None:
        if psutil is None:
            raise RuntimeError("psutil not installed — `pip install psutil`")

    def read(self) -> Iterator[dict]:
        while True:
            yield from self._tick()
            time.sleep(self.interval_seconds)

    def _tick(self) -> Iterator[dict]:
        seen = set()
        for p in psutil.process_iter(["pid", "ppid", "name", "exe", "cmdline", "username"]):
            try:
                info = p.info
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
            seen.add(info["pid"])
            if info["pid"] in self._last_pids:
                continue  # not new — skip
            yield self._event("create", info)

        # Disappeared
        for pid in self._last_pids - seen:
            yield self._event("terminate", {"pid": pid})

        self._last_pids = seen

    def _event(self, activity: str, info: dict) -> dict:
        sha256 = ""
        if self.hash_executables and info.get("exe"):
            sha256 = self._hash(info["exe"])
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "edr",
            "agent_id": self.agent_id,
            "host": os.uname().nodename if hasattr(os, "uname") else os.environ.get("COMPUTERNAME", ""),
            "level": "info",
            "service": "process_monitor",
            "message": f"{activity} {info.get('name','?')} pid={info.get('pid')}",
            "meta": {
                "category": "process",
                "ocsf.class_uid": 1007,
                "process.pid": info.get("pid"),
                "process.parent.pid": info.get("ppid"),
                "process.name": info.get("name"),
                "process.executable": info.get("exe"),
                "process.command_line": " ".join(info.get("cmdline") or []),
                "process.user": info.get("username"),
                "process.hash_sha256": sha256,
                "activity": activity,
            },
        }

    @staticmethod
    def _hash(path: str) -> str:
        try:
            h = hashlib.sha256()
            with open(path, "rb") as f:
                for chunk in iter(lambda: f.read(1 << 16), b""):
                    h.update(chunk)
            return h.hexdigest()
        except OSError:
            return ""
