from __future__ import annotations

import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator

from agent.src.models import LogEvent
from agent.src.readers.base import LogReader

LEVEL_PATTERN = re.compile(
    r"\b(EMERGENCY|EMERG|ALERT|CRITICAL|CRIT|ERROR|ERR|WARNING|WARN|NOTICE|INFO|DEBUG)\b",
    re.IGNORECASE,
)

# RFC 3164 syslog: "Mon DD HH:MM:SS hostname process[pid]: message"
SYSLOG_RE = re.compile(
    r"^(?P<ts>\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+"
    r"(?P<syslog_host>\S+)\s+"
    r"(?P<process>[^\[:]+?)(?:\[(?P<pid>\d+)\])?\s*:\s*"
    r"(?P<body>.*)$"
)

# Nginx error log: "YYYY/MM/DD HH:MM:SS [level] pid#tid: *connid message"
NGINX_ERR_RE = re.compile(
    r"^(?P<ts>\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2})\s+"
    r"\[(?P<level>\w+)\]\s+"
    r"(?P<pid>\d+)#(?P<tid>\d+):\s+"
    r"(?:\*(?P<conn>\d+)\s+)?"
    r"(?P<body>.*)$"
)

# Common Log Format / Combined (Apache/Nginx access): IP - - [ts] "method url proto" status size ...
ACCESS_RE = re.compile(
    r'^(?P<remote_ip>\S+)\s+\S+\s+(?P<remote_user>\S+)\s+'
    r'\[(?P<ts>[^\]]+)\]\s+'
    r'"(?P<method>\w+)\s+(?P<path>\S+)\s+\S+"\s+'
    r'(?P<status>\d{3})\s+(?P<body_bytes>\d+|-)'
)

OFFSET_DIR = Path("/data/offsets")


class FileReader(LogReader):
    """Reads a log file with tail-follow semantics and offset persistence."""

    def __init__(self, path: str, service: str, poll_interval: float = 0.5) -> None:
        super().__init__(source=path, service=service)
        self.path = path
        self.poll_interval = poll_interval
        self._fh: open | None = None
        self._offset_file = OFFSET_DIR / f"{Path(path).name}.offset"

    def _save_offset(self, offset: int) -> None:
        OFFSET_DIR.mkdir(parents=True, exist_ok=True)
        self._offset_file.write_text(str(offset))

    def _load_offset(self) -> int:
        if self._offset_file.exists():
            try:
                return int(self._offset_file.read_text().strip())
            except ValueError:
                pass
        return 0

    @staticmethod
    def _detect_level(line: str) -> str:
        m = LEVEL_PATTERN.search(line)
        if not m:
            return "INFO"
        raw = m.group(1).upper()
        mapping = {
            "EMERGENCY": "CRITICAL", "EMERG": "CRITICAL",
            "ALERT": "CRITICAL", "CRIT": "CRITICAL",
            "ERR": "ERROR", "WARN": "WARNING",
            "NOTICE": "INFO",
        }
        return mapping.get(raw, raw)

    @staticmethod
    def _access_status_to_level(status: int) -> str:
        if status >= 500:
            return "ERROR"
        if status >= 400:
            return "WARNING"
        return "INFO"

    def _parse_line(self, line: str) -> dict[str, Any]:
        """Try structured parsers, fall back to raw line with level detection."""
        meta: dict[str, Any] = {}

        m = SYSLOG_RE.match(line)
        if m:
            meta["process"] = m.group("process")
            if m.group("pid"):
                meta["pid"] = m.group("pid")
            meta["syslog_host"] = m.group("syslog_host")
            return {
                "level": self._detect_level(m.group("body")),
                "message": m.group("body"),
                "meta": meta,
            }

        m = NGINX_ERR_RE.match(line)
        if m:
            nginx_level = m.group("level").upper()
            level_map = {"EMERG": "CRITICAL", "ALERT": "CRITICAL", "CRIT": "CRITICAL",
                         "ERR": "ERROR", "WARN": "WARNING", "NOTICE": "INFO"}
            meta["pid"] = m.group("pid")
            meta["tid"] = m.group("tid")
            if m.group("conn"):
                meta["connection"] = m.group("conn")
            return {
                "level": level_map.get(nginx_level, nginx_level),
                "message": m.group("body"),
                "meta": meta,
            }

        m = ACCESS_RE.match(line)
        if m:
            status = int(m.group("status"))
            meta["remote_ip"] = m.group("remote_ip")
            meta["method"] = m.group("method")
            meta["path"] = m.group("path")
            meta["status_code"] = status
            body_bytes = m.group("body_bytes")
            if body_bytes != "-":
                meta["body_bytes"] = int(body_bytes)
            return {
                "level": self._access_status_to_level(status),
                "message": line,
                "meta": meta,
            }

        return {
            "level": self._detect_level(line),
            "message": line,
            "meta": meta,
        }

    def read(self) -> Generator[LogEvent, None, None]:
        while not os.path.exists(self.path):
            time.sleep(1)

        self._fh = open(self.path, "r", encoding="utf-8", errors="replace")
        offset = self._load_offset()
        file_size = os.path.getsize(self.path)

        if offset > file_size:
            offset = 0
        self._fh.seek(offset)

        while True:
            line = self._fh.readline()
            if not line:
                self._save_offset(self._fh.tell())
                time.sleep(self.poll_interval)
                new_size = os.path.getsize(self.path)
                if new_size < self._fh.tell():
                    self._fh.seek(0)
                continue

            line = line.rstrip("\n\r")
            if not line:
                continue

            parsed = self._parse_line(line)

            yield LogEvent(
                timestamp=datetime.now(timezone.utc).isoformat(),
                source=self.path,
                level=parsed["level"],
                message=parsed["message"],
                service=self.service,
                meta=parsed.get("meta", {}),
            ).with_event_id()

    def close(self) -> None:
        if self._fh:
            self._save_offset(self._fh.tell())
            self._fh.close()
