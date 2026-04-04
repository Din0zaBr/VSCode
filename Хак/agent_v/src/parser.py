"""
Парсинг строк логов Linux в структурированный формат.

Поддерживаемые форматы:
  - syslog (Ubuntu: /var/log/syslog, /var/log/auth.log, /var/log/daemon.log)
  - kernel log (/var/log/kern.log, dmesg)
  - journald (systemd structured fields)
  - RED OS / CentOS (/var/log/messages, /var/log/secure)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from typing import Optional


class LogLevel(str, Enum):
    EMERGENCY = "emergency"
    ALERT = "alert"
    CRITICAL = "critical"
    ERROR = "error"
    WARNING = "warning"
    NOTICE = "notice"
    INFO = "info"
    DEBUG = "debug"


@dataclass
class ParsedLog:
    timestamp: str
    hostname: str
    service: str
    pid: Optional[int]
    message: str
    level: LogLevel
    source_file: str = ""
    raw: str = ""
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["level"] = self.level.value
        return d


# ── Определение уровня логов по содержимому ──────────────────────────────

_LEVEL_PATTERNS: list[tuple[re.Pattern, LogLevel]] = [
    (re.compile(r"\b(emerg(ency)?)\b", re.I), LogLevel.EMERGENCY),
    (re.compile(r"\b(alert)\b", re.I), LogLevel.ALERT),
    (re.compile(r"\b(crit(ical)?|panic)\b", re.I), LogLevel.CRITICAL),
    (re.compile(r"\b(err(or)?|fail(ed|ure)?|fatal)\b", re.I), LogLevel.ERROR),
    (re.compile(r"\b(warn(ing)?)\b", re.I), LogLevel.WARNING),
    (re.compile(r"\b(notice)\b", re.I), LogLevel.NOTICE),
    (re.compile(r"\b(debug)\b", re.I), LogLevel.DEBUG),
]

# Syslog severity из journald (0-7)
_SYSLOG_SEVERITY_MAP: dict[int, LogLevel] = {
    0: LogLevel.EMERGENCY,
    1: LogLevel.ALERT,
    2: LogLevel.CRITICAL,
    3: LogLevel.ERROR,
    4: LogLevel.WARNING,
    5: LogLevel.NOTICE,
    6: LogLevel.INFO,
    7: LogLevel.DEBUG,
}


def detect_level(message: str, priority: Optional[int] = None) -> LogLevel:
    """Определяет уровень лога по syslog priority или по ключевым словам."""
    if priority is not None and priority in _SYSLOG_SEVERITY_MAP:
        return _SYSLOG_SEVERITY_MAP[priority]

    for pattern, level in _LEVEL_PATTERNS:
        if pattern.search(message):
            return level

    return LogLevel.INFO


# ── Парсеры для разных форматов ──────────────────────────────────────────

# Стандартный syslog: "Mar 20 14:23:45 hostname service[1234]: message"
_SYSLOG_RE = re.compile(
    r"^(?P<timestamp>\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+"
    r"(?P<hostname>\S+)\s+"
    r"(?P<service>\S+?)(?:\[(?P<pid>\d+)\])?:\s+"
    r"(?P<message>.*)$"
)

# Kernel: "Mar 20 14:23:45 hostname kernel: [12345.678901] message"
_KERN_RE = re.compile(
    r"^(?P<timestamp>\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+"
    r"(?P<hostname>\S+)\s+"
    r"kernel:\s+\[\s*(?P<uptime>[\d.]+)\]\s+"
    r"(?P<message>.*)$"
)

# RFC 5424: "<PRI>1 2026-03-20T14:23:45.000000+00:00 hostname service pid msgid msg"
_RFC5424_RE = re.compile(
    r"^<(?P<pri>\d+)>\d*\s*"
    r"(?P<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*)\s+"
    r"(?P<hostname>\S+)\s+"
    r"(?P<service>\S+)\s+"
    r"(?P<pid>\S+)\s+"
    r"(?P<msgid>\S+)\s*"
    r"(?P<message>.*)$"
)


def _normalize_timestamp(raw_ts: str) -> str:
    """Приводит timestamp к ISO 8601. Если год не указан — подставляет текущий."""
    now = datetime.now()

    # Формат syslog: "Mar 20 14:23:45"
    for fmt in ("%b %d %H:%M:%S", "%b  %d %H:%M:%S"):
        try:
            parsed = datetime.strptime(raw_ts, fmt).replace(year=now.year)
            return parsed.isoformat()
        except ValueError:
            continue

    # Уже ISO-подобный формат
    if "T" in raw_ts:
        return raw_ts

    return raw_ts


def parse_syslog(line: str, source_file: str = "") -> Optional[ParsedLog]:
    """Парсит строку в формате syslog (Ubuntu /var/log/syslog, auth.log и т.д.)."""
    m = _SYSLOG_RE.match(line)
    if not m:
        return None

    message = m.group("message")
    pid_str = m.group("pid")

    return ParsedLog(
        timestamp=_normalize_timestamp(m.group("timestamp")),
        hostname=m.group("hostname"),
        service=m.group("service"),
        pid=int(pid_str) if pid_str else None,
        message=message,
        level=detect_level(message),
        source_file=source_file,
        raw=line,
    )


def parse_kernel(line: str, source_file: str = "") -> Optional[ParsedLog]:
    """Парсит строку kernel log (/var/log/kern.log)."""
    m = _KERN_RE.match(line)
    if not m:
        return None

    message = m.group("message")

    return ParsedLog(
        timestamp=_normalize_timestamp(m.group("timestamp")),
        hostname=m.group("hostname"),
        service="kernel",
        pid=None,
        message=message,
        level=detect_level(message),
        source_file=source_file,
        raw=line,
        extra={"uptime_seconds": float(m.group("uptime"))},
    )


def parse_rfc5424(line: str, source_file: str = "") -> Optional[ParsedLog]:
    """Парсит строку в формате RFC 5424."""
    m = _RFC5424_RE.match(line)
    if not m:
        return None

    message = m.group("message")
    pri = int(m.group("pri"))
    severity = pri % 8
    pid_str = m.group("pid")

    return ParsedLog(
        timestamp=m.group("timestamp"),
        hostname=m.group("hostname"),
        service=m.group("service"),
        pid=int(pid_str) if pid_str.isdigit() else None,
        message=message,
        level=detect_level(message, priority=severity),
        source_file=source_file,
        raw=line,
        extra={"facility": pri // 8, "msgid": m.group("msgid")},
    )


def parse_journald_entry(entry: dict) -> ParsedLog:
    """Парсит запись из systemd journal (словарь полей)."""
    priority = entry.get("PRIORITY")
    message = entry.get("MESSAGE", "")

    ts = entry.get("__REALTIME_TIMESTAMP")
    if isinstance(ts, datetime):
        timestamp = ts.isoformat()
    elif ts is not None:
        timestamp = str(ts)
    else:
        timestamp = datetime.now().isoformat()

    return ParsedLog(
        timestamp=timestamp,
        hostname=entry.get("_HOSTNAME", "unknown"),
        service=entry.get("SYSLOG_IDENTIFIER", entry.get("_COMM", "unknown")),
        pid=int(entry["_PID"]) if "_PID" in entry else None,
        message=message if isinstance(message, str) else message.decode("utf-8", errors="replace"),
        level=detect_level(
            message if isinstance(message, str) else "",
            priority=int(priority) if priority is not None else None,
        ),
        source_file="journald",
        extra={
            "unit": entry.get("_SYSTEMD_UNIT", ""),
            "uid": entry.get("_UID"),
            "gid": entry.get("_GID"),
            "transport": entry.get("_TRANSPORT", ""),
        },
    )


# ── Универсальный парсер ─────────────────────────────────────────────────

_PARSERS = [parse_kernel, parse_rfc5424, parse_syslog]


def parse_line(line: str, source_file: str = "") -> ParsedLog:
    """
    Пытается распарсить строку лога всеми доступными парсерами.
    Если ни один не подошёл — возвращает запись с raw-строкой.
    """
    line = line.rstrip("\n\r")
    if not line:
        return ParsedLog(
            timestamp=datetime.now().isoformat(),
            hostname="unknown",
            service="unknown",
            pid=None,
            message="",
            level=LogLevel.INFO,
            source_file=source_file,
            raw=line,
        )

    for parser in _PARSERS:
        result = parser(line, source_file)
        if result is not None:
            return result

    # Fallback: не удалось распарсить — сохраняем как есть
    return ParsedLog(
        timestamp=datetime.now().isoformat(),
        hostname="unknown",
        service="unknown",
        pid=None,
        message=line,
        level=detect_level(line),
        source_file=source_file,
        raw=line,
    )
