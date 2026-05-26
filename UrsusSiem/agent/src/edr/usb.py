"""USB-device watcher.

Linux: poll /proc/diskstats + /sys/bus/usb/devices for new VID:PID.
Windows: query WMI Win32_USBControllerDevice (pywin32) — placeholder
here; production build pulls pywin32 only on Windows.

Emits a single event when a previously-unseen device shows up.
"""
from __future__ import annotations

import logging
import os
import platform
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterator

log = logging.getLogger(__name__)


@dataclass
class USBReader:
    interval_seconds: int = 30
    agent_id: str = "edr"
    _seen: set[str] = field(default_factory=set)

    def read(self) -> Iterator[dict]:
        while True:
            yield from self._tick()
            time.sleep(self.interval_seconds)

    def _tick(self) -> Iterator[dict]:
        for dev_id, info in self._enumerate():
            if dev_id in self._seen:
                continue
            self._seen.add(dev_id)
            yield self._event(dev_id, info)

    def _enumerate(self) -> list[tuple[str, dict]]:
        sys_platform = platform.system()
        if sys_platform == "Linux":
            return self._enumerate_linux()
        if sys_platform == "Windows":
            return self._enumerate_windows()
        return []

    def _enumerate_linux(self) -> list[tuple[str, dict]]:
        root = "/sys/bus/usb/devices"
        out: list[tuple[str, dict]] = []
        try:
            for d in os.listdir(root):
                base = os.path.join(root, d)
                idv = self._readfile(os.path.join(base, "idVendor"))
                idp = self._readfile(os.path.join(base, "idProduct"))
                if not idv or not idp:
                    continue
                manufacturer = self._readfile(os.path.join(base, "manufacturer"))
                product = self._readfile(os.path.join(base, "product"))
                dev_id = f"{idv}:{idp}"
                out.append((dev_id, {
                    "vendor_id": idv, "product_id": idp,
                    "manufacturer": manufacturer, "product": product,
                }))
        except OSError as e:
            log.warning("usb enumerate (linux): %s", e)
        return out

    def _enumerate_windows(self) -> list[tuple[str, dict]]:
        # pywin32 path — kept short to avoid forcing the import on non-Win hosts.
        try:
            import wmi  # type: ignore
            c = wmi.WMI()
            out: list[tuple[str, dict]] = []
            for usb in c.Win32_USBHub():
                dev_id = (usb.DeviceID or "").split("\\")[-1]
                out.append((dev_id, {"device_id": usb.DeviceID, "name": usb.Name}))
            return out
        except Exception as e:
            log.warning("usb enumerate (windows): %s", e)
            return []

    def _event(self, dev_id: str, info: dict) -> dict:
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "edr",
            "agent_id": self.agent_id,
            "host": os.uname().nodename if hasattr(os, "uname") else os.environ.get("COMPUTERNAME", ""),
            "level": "notice",
            "service": "usb_monitor",
            "message": f"new USB device: {dev_id} {info.get('product','')}",
            "meta": {"category": "usb", "device_id": dev_id, **info},
        }

    @staticmethod
    def _readfile(path: str) -> str:
        try:
            with open(path, "r") as f:
                return f.read().strip()
        except OSError:
            return ""
