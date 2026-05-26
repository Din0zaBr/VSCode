"""EDR-light agent extensions (Sprint 11).

Adds host-telemetry on top of the existing log-readers so URSUS becomes
a Tier-3 endpoint-detection competitor for МСБ that can't afford
Kaspersky EDR / CrowdStrike.

Modules:
    processes        — periodic snapshot of running processes
    connections      — periodic snapshot of network connections
    file_integrity   — inotify / ReadDirectoryChangesW watcher
    usb              — udev / WMI event reader
    startup          — diff cron / systemd / Registry Run keys

Each module returns OCSF-compatible event dicts (Process Activity 1007,
File System Activity 1001, Network Activity 4001) so the server can
treat them just like any other source.
"""

from .processes import ProcessReader
from .connections import ConnectionReader
from .file_integrity import FileIntegrityReader
from .usb import USBReader

__all__ = ["ProcessReader", "ConnectionReader", "FileIntegrityReader", "USBReader"]
