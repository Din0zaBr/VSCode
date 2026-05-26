"""File-integrity watcher (FIM).

Linux: inotify via the `watchdog` lib.
Windows: ReadDirectoryChangesW via the same `watchdog` abstraction.

Watches a configurable list of paths (default: /etc, ~/.ssh, /usr/local/bin
on Linux; C:\\Windows\\System32, C:\\Users on Windows). Emits OCSF File
System Activity events (1001) on create/modify/delete.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterator, Queue

try:
    from watchdog.observers import Observer  # type: ignore
    from watchdog.events import FileSystemEventHandler  # type: ignore
except ImportError:
    Observer = None
    FileSystemEventHandler = object  # type: ignore

import queue
import threading

log = logging.getLogger(__name__)


@dataclass
class FileIntegrityReader:
    paths: list[str] = field(default_factory=lambda: ["/etc", "/usr/local/bin"])
    agent_id: str = "edr"
    _q: "queue.Queue[dict]" = field(default_factory=queue.Queue)

    def __post_init__(self) -> None:
        if Observer is None:
            raise RuntimeError("watchdog not installed — `pip install watchdog`")
        self._observer = Observer()
        handler = _Handler(self._q, self.agent_id)
        for p in self.paths:
            if os.path.exists(p):
                self._observer.schedule(handler, p, recursive=True)
            else:
                log.warning("FIM: path missing %s", p)
        self._observer.start()

    def read(self) -> Iterator[dict]:
        while True:
            try:
                yield self._q.get(timeout=1)
            except queue.Empty:
                continue


class _Handler(FileSystemEventHandler):
    def __init__(self, q: queue.Queue, agent_id: str):
        super().__init__()
        self.q = q
        self.agent_id = agent_id
        self.host = os.uname().nodename if hasattr(os, "uname") else os.environ.get("COMPUTERNAME", "")

    def _emit(self, activity: str, path: str) -> None:
        self.q.put({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": "edr",
            "agent_id": self.agent_id,
            "host": self.host,
            "level": "info",
            "service": "fim",
            "message": f"{activity}: {path}",
            "meta": {
                "category": "file",
                "ocsf.class_uid": 1001,
                "file.path": path,
                "action": activity,
            },
        })

    def on_created(self, event): self._emit("create", event.src_path)
    def on_modified(self, event): self._emit("modify", event.src_path)
    def on_deleted(self, event): self._emit("delete", event.src_path)
    def on_moved(self, event): self._emit("rename", event.src_path)
