from __future__ import annotations

import json
import sqlite3
import threading
from typing import Any

from agent.src.models import LogEvent


class LocalBuffer:
    """SQLite-backed buffer for offline queuing when the server is unreachable."""

    def __init__(self, db_path: str = "/data/buffer.db") -> None:
        self.db_path = db_path
        self._local = threading.local()
        self._init_db(self._get_conn())

    def _get_conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn"):
            self._local.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        return self._local.conn

    @staticmethod
    def _init_db(conn: sqlite3.Connection) -> None:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS buffer (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payload TEXT NOT NULL,
                created_at REAL NOT NULL DEFAULT (strftime('%s','now'))
            )"""
        )
        conn.commit()

    def push(self, events: list[LogEvent]) -> None:
        conn = self._get_conn()
        conn.executemany(
            "INSERT INTO buffer (payload) VALUES (?)",
            [(e.model_dump_json(),) for e in events],
        )
        conn.commit()

    def peek(self, limit: int = 500) -> list[tuple[int, LogEvent]]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT id, payload FROM buffer ORDER BY id LIMIT ?", (limit,)
        ).fetchall()
        result: list[tuple[int, LogEvent]] = []
        for row_id, payload in rows:
            result.append((row_id, LogEvent.model_validate_json(payload)))
        return result

    def delete(self, ids: list[int]) -> None:
        if not ids:
            return
        conn = self._get_conn()
        placeholders = ",".join("?" for _ in ids)
        conn.execute(f"DELETE FROM buffer WHERE id IN ({placeholders})", ids)
        conn.commit()

    def count(self) -> int:
        conn = self._get_conn()
        row = conn.execute("SELECT COUNT(*) FROM buffer").fetchone()
        return row[0] if row else 0
