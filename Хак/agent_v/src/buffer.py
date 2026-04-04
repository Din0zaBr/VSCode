"""
Локальный буфер логов на основе SQLite.

Обеспечивает персистентное хранение при недоступности сервера.
При восстановлении соединения — буфер автоматически дренируется.
"""

from __future__ import annotations

import sqlite3
import json
import logging
import threading
from pathlib import Path

from .parser import ParsedLog

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS log_buffer (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    payload     TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
"""

DEFAULT_DB_PATH = "/var/lib/log-agent/buffer.db"
DEFAULT_MAX_SIZE_MB = 512


class LogBuffer:
    """
    Thread-safe буфер логов на SQLite.

    Использование:
        buf = LogBuffer()
        buf.push(parsed_log)           # сохранить в буфер
        batch = buf.peek(100)          # прочитать до 100 записей (без удаления)
        buf.ack([id1, id2, ...])       # подтвердить успешную отправку
    """

    def __init__(
        self,
        db_path: str = DEFAULT_DB_PATH,
        max_size_mb: int = DEFAULT_MAX_SIZE_MB,
    ):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._db_path = db_path
        self._max_size_bytes = max_size_mb * 1024 * 1024
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._conn.executescript(_SCHEMA)

    def push(self, log: ParsedLog):
        """Добавить запись в буфер."""
        payload = json.dumps(log.to_dict(), ensure_ascii=False)
        with self._lock:
            self._conn.execute(
                "INSERT INTO log_buffer (payload) VALUES (?)", (payload,)
            )
            self._conn.commit()
        self._enforce_limit()

    def push_batch(self, logs: list[ParsedLog]):
        """Добавить пачку записей в буфер."""
        rows = [
            (json.dumps(log.to_dict(), ensure_ascii=False),) for log in logs
        ]
        with self._lock:
            self._conn.executemany(
                "INSERT INTO log_buffer (payload) VALUES (?)", rows
            )
            self._conn.commit()
        self._enforce_limit()

    def peek(self, limit: int = 500) -> list[tuple[int, dict]]:
        """
        Возвращает до `limit` самых старых записей из буфера.
        Каждый элемент — (id, payload_dict).
        """
        with self._lock:
            cursor = self._conn.execute(
                "SELECT id, payload FROM log_buffer ORDER BY id ASC LIMIT ?",
                (limit,),
            )
            return [
                (row[0], json.loads(row[1])) for row in cursor.fetchall()
            ]

    def ack(self, ids: list[int]):
        """Удалить успешно отправленные записи по их id."""
        if not ids:
            return
        placeholders = ",".join("?" for _ in ids)
        with self._lock:
            self._conn.execute(
                f"DELETE FROM log_buffer WHERE id IN ({placeholders})", ids
            )
            self._conn.commit()

    def size(self) -> int:
        """Количество записей в буфере."""
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*) FROM log_buffer"
            ).fetchone()
            return row[0] if row else 0

    def _enforce_limit(self):
        """Удаляет самые старые записи, если БД превышает лимит."""
        try:
            db_size = Path(self._db_path).stat().st_size
        except OSError:
            return

        if db_size <= self._max_size_bytes:
            return

        logger.warning(
            "Буфер превысил лимит (%d MB), удаляем старые записи",
            db_size // (1024 * 1024),
        )
        with self._lock:
            self._conn.execute(
                "DELETE FROM log_buffer WHERE id IN "
                "(SELECT id FROM log_buffer ORDER BY id ASC LIMIT 1000)"
            )
            self._conn.commit()

    def close(self):
        self._conn.close()
