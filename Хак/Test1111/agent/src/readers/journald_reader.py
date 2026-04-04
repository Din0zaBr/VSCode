from __future__ import annotations

import json
import subprocess
import time
from datetime import datetime, timezone
from typing import Generator

from agent.src.models import LogEvent
from agent.src.readers.base import LogReader

PRIORITY_MAP = {
    "0": "CRITICAL", "1": "CRITICAL", "2": "CRITICAL",
    "3": "ERROR", "4": "WARNING", "5": "INFO",
    "6": "INFO", "7": "DEBUG",
}


class JournaldReader(LogReader):
    """Reads logs from systemd journald via journalctl subprocess."""

    def __init__(self, unit: str, service: str) -> None:
        super().__init__(source=f"journald:{unit}", service=service)
        self.unit = unit
        self._proc: subprocess.Popen | None = None

    def read(self) -> Generator[LogEvent, None, None]:
        cmd = [
            "journalctl",
            "--follow",
            "--output=json",
            "--no-pager",
        ]
        if self.unit:
            cmd += [f"--unit={self.unit}"]

        self._proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )

        assert self._proc.stdout is not None
        for raw_line in self._proc.stdout:
            raw_line = raw_line.strip()
            if not raw_line:
                continue
            try:
                entry = json.loads(raw_line)
            except json.JSONDecodeError:
                continue

            ts_usec = entry.get("__REALTIME_TIMESTAMP")
            if ts_usec:
                ts = datetime.fromtimestamp(
                    int(ts_usec) / 1_000_000, tz=timezone.utc
                ).isoformat()
            else:
                ts = datetime.now(timezone.utc).isoformat()

            priority = str(entry.get("PRIORITY", "6"))
            level = PRIORITY_MAP.get(priority, "INFO")
            message = entry.get("MESSAGE", "")
            if isinstance(message, list):
                message = " ".join(str(m) for m in message)

            meta = {
                "pid": entry.get("_PID", ""),
                "uid": entry.get("_UID", ""),
                "gid": entry.get("_GID", ""),
                "unit": entry.get("_SYSTEMD_UNIT", self.unit),
                "exe": entry.get("_EXE", ""),
                "cmdline": entry.get("_CMDLINE", ""),
                "comm": entry.get("_COMM", ""),
                "transport": entry.get("_TRANSPORT", ""),
                "boot_id": entry.get("_BOOT_ID", ""),
                "machine_id": entry.get("_MACHINE_ID", ""),
            }
            meta = {k: v for k, v in meta.items() if v}

            yield LogEvent(
                timestamp=ts,
                source=self.source,
                level=level,
                message=message,
                service=self.service,
                meta=meta,
            ).with_event_id()

    def close(self) -> None:
        if self._proc:
            self._proc.terminate()
            self._proc.wait(timeout=5)
