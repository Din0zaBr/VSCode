"""
Windows Event Log reader using the pywin32 win32evtlog API.

Supports reading from any Windows Event Log channel (System, Security, Application,
or custom channels like Microsoft-Windows-Sysmon/Operational).

Requires: pywin32 >= 306  (pip install pywin32 && python Scripts/pywin32_postinstall.py -install)
Not importable on non-Windows systems — import guarded in main.py.
"""
from __future__ import annotations

import os
import platform
import struct
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator

if platform.system() != "Windows":
    raise RuntimeError("winevent_reader is only available on Windows")

import win32evtlog          # type: ignore[import]
import win32evtlogutil      # type: ignore[import]
import win32con             # type: ignore[import]
import pywintypes           # type: ignore[import]

from agent.src.models import LogEvent
from agent.src.readers.base import LogReader

# ── Windows Event Level → severity string ────────────────────────────────────
WINEVENT_LEVEL: dict[int, str] = {
    0: "INFO",       # EVENTLOG_SUCCESS (informational)
    1: "CRITICAL",   # EVENTLOG_ERROR_TYPE
    2: "WARNING",    # EVENTLOG_WARNING_TYPE
    4: "INFO",       # EVENTLOG_INFORMATION_TYPE
    8: "INFO",       # EVENTLOG_AUDIT_SUCCESS
    16: "WARNING",   # EVENTLOG_AUDIT_FAILURE
}

# Human-readable labels for Security audit events
SECURITY_EVENT_LABELS: dict[int, str] = {
    4624: "Logon",
    4625: "LogonFailure",
    4634: "Logoff",
    4647: "UserInitiatedLogoff",
    4648: "ExplicitLogon",
    4656: "ObjectHandleRequested",
    4663: "ObjectAccess",
    4672: "SpecialPrivilegeLogon",
    4688: "ProcessCreate",
    4689: "ProcessTerminate",
    4698: "ScheduledTaskCreated",
    4702: "ScheduledTaskUpdated",
    4703: "TokenRightEnabled",
    4720: "UserAccountCreated",
    4722: "UserAccountEnabled",
    4723: "PasswordChangeAttempt",
    4724: "PasswordResetAttempt",
    4725: "UserAccountDisabled",
    4726: "UserAccountDeleted",
    4728: "MemberAddedToGroup",
    4732: "MemberAddedToLocalGroup",
    4740: "AccountLockedOut",
    4756: "MemberAddedToUniversalGroup",
    4768: "KerberosTicketRequested",
    4769: "KerberosServiceTicketRequested",
    4771: "KerberosPreAuthFailed",
    4776: "NTLMAuthentication",
    4778: "SessionReconnected",
    4779: "SessionDisconnected",
    4798: "UserLocalGroupsEnumerated",
    4799: "LocalGroupMembersEnumerated",
    7034: "ServiceCrashed",
    7036: "ServiceStateChange",
    7045: "ServiceInstalled",
}

# Offset persistence directory — consistent with FileReader
OFFSET_DIR = Path(os.environ.get("PROGRAMDATA", "C:/ProgramData")) / "logvault-agent" / "offsets"


class WinEventReader(LogReader):
    """
    Tail-follows a Windows Event Log channel with record-number persistence.

    Args:
        channel:    Event Log channel name, e.g. "System", "Security",
                    "Application", or "Microsoft-Windows-Sysmon/Operational".
        service:    Logical service tag sent to the server (e.g. "windows").
        event_ids:  Optional whitelist of Event IDs to forward. Empty = all events.
        poll_interval: Seconds to wait when no new records are available.
    """

    def __init__(
        self,
        channel: str = "System",
        service: str = "windows",
        event_ids: list[int] | None = None,
        poll_interval: float = 1.0,
    ) -> None:
        super().__init__(source=f"winevent:{channel}", service=service)
        self.channel = channel
        self.event_ids: frozenset[int] = frozenset(event_ids) if event_ids else frozenset()
        self.poll_interval = poll_interval
        self._handle = None
        self._closed = False

        # Offset file stores the last-read record number as a plain integer
        safe_name = channel.replace("/", "_").replace("\\", "_")
        OFFSET_DIR.mkdir(parents=True, exist_ok=True)
        self._offset_file = OFFSET_DIR / f"{safe_name}.offset"

    # ── Offset helpers ────────────────────────────────────────────────────────

    def _load_offset(self) -> int | None:
        """Return last persisted record number, or None to start from current tail."""
        if self._offset_file.exists():
            try:
                val = self._offset_file.read_text().strip()
                return int(val) if val else None
            except (ValueError, OSError):
                pass
        return None

    def _save_offset(self, record_number: int) -> None:
        try:
            self._offset_file.write_text(str(record_number))
        except OSError:
            pass

    # ── Event helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def _level_from_type(event_type: int) -> str:
        return WINEVENT_LEVEL.get(event_type, "INFO")

    def _format_message(self, event) -> str:
        """
        Try win32evtlogutil.SafeFormatMessage first (requires the source DLL).
        Fall back to the raw insertion strings if formatting fails.
        """
        try:
            return win32evtlogutil.SafeFormatMessage(event, self.channel)
        except Exception:
            strings = event.StringInserts
            if strings:
                return " | ".join(str(s) for s in strings)
            return f"EventID={event.EventID & 0xFFFF}"

    def _build_meta(self, event) -> dict:
        event_id = event.EventID & 0xFFFF  # mask to strip severity bits
        meta: dict = {
            "event_id_raw": event_id,
            "record_number": event.RecordNumber,
            "source_name": event.SourceName,
            "computer_name": event.ComputerName,
            "event_category": event.EventCategory,
        }
        if event.Sid:
            try:
                import win32security  # type: ignore[import]
                meta["sid"] = str(win32security.ConvertSidToStringSid(event.Sid))
            except Exception:
                pass
        label = SECURITY_EVENT_LABELS.get(event_id)
        if label:
            meta["event_label"] = label
        return meta

    # ── Core reader ───────────────────────────────────────────────────────────

    def read(self) -> Generator[LogEvent, None, None]:
        flags = win32evtlog.EVENTLOG_FORWARDS_READ | win32evtlog.EVENTLOG_SEQUENTIAL_READ

        self._handle = win32evtlog.OpenEventLog(None, self.channel)
        last_record = self._load_offset()

        # If no saved offset, position at the current end so we only
        # stream *new* events (avoid replaying the entire log on first run).
        if last_record is None:
            try:
                total = win32evtlog.GetNumberOfEventLogRecords(self._handle)
                # Read the last batch to learn the highest record number
                peek = win32evtlog.ReadEventLog(
                    self._handle,
                    win32evtlog.EVENTLOG_BACKWARDS_READ | win32evtlog.EVENTLOG_SEQUENTIAL_READ,
                    0,
                )
                if peek:
                    last_record = peek[0].RecordNumber
                    self._save_offset(last_record)
            except Exception:
                last_record = 0

        while not self._closed:
            try:
                events = win32evtlog.ReadEventLog(self._handle, flags, 0)
            except pywintypes.error as exc:
                # ERROR_HANDLE_EOF (38) — no new records yet
                if exc.winerror == 38:
                    time.sleep(self.poll_interval)
                    continue
                # ERROR_EVENTLOG_FILE_CHANGED (1503) — log was cleared/rotated
                if exc.winerror == 1503:
                    win32evtlog.CloseEventLog(self._handle)
                    self._handle = win32evtlog.OpenEventLog(None, self.channel)
                    last_record = 0
                    self._save_offset(0)
                    continue
                raise

            if not events:
                time.sleep(self.poll_interval)
                continue

            for event in events:
                if self._closed:
                    return

                record_number = event.RecordNumber

                # Skip records we've already processed
                if last_record is not None and record_number <= last_record:
                    continue

                event_id = event.EventID & 0xFFFF

                # Apply Event ID filter if configured
                if self.event_ids and event_id not in self.event_ids:
                    last_record = record_number
                    self._save_offset(record_number)
                    continue

                # Build timestamp from pywintypes.datetime
                try:
                    ts = datetime.fromtimestamp(
                        int(event.TimeGenerated), tz=timezone.utc
                    ).isoformat()
                except Exception:
                    ts = datetime.now(timezone.utc).isoformat()

                message = self._format_message(event)
                level = self._level_from_type(event.EventType)
                meta = self._build_meta(event)

                last_record = record_number
                self._save_offset(record_number)

                yield LogEvent(
                    timestamp=ts,
                    source=self.source,
                    level=level,
                    message=message,
                    service=self.service,
                    meta=meta,
                ).with_event_id()

    def close(self) -> None:
        self._closed = True
        if self._handle:
            try:
                win32evtlog.CloseEventLog(self._handle)
            except Exception:
                pass
            self._handle = None
