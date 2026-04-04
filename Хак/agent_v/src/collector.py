"""
Сборщик логов: отслеживание файлов (tail -f) и чтение journald.

Поддерживает:
  - Tail нескольких файлов одновременно с отслеживанием позиции (offset)
  - Чтение systemd journal с фильтрацией по cursor
  - Автоматическое восстановление позиции после перезапуска
"""

from __future__ import annotations

import json
import os
import time
import logging
from pathlib import Path
from typing import Callable, Optional
from dataclasses import dataclass

from .parser import ParsedLog, parse_line, parse_journald_entry

logger = logging.getLogger(__name__)

LogCallback = Callable[[ParsedLog], None]


@dataclass
class FileState:
    path: str
    inode: int
    offset: int


class PositionTracker:
    """Сохраняет позиции чтения файлов между перезапусками агента."""

    def __init__(self, state_file: str = "/var/lib/log-agent/positions.json"):
        self._state_file = Path(state_file)
        self._positions: dict[str, FileState] = {}
        self._load()

    def _load(self):
        if not self._state_file.exists():
            return
        try:
            data = json.loads(self._state_file.read_text())
            for path, state in data.items():
                self._positions[path] = FileState(**state)
        except (json.JSONDecodeError, KeyError):
            logger.warning("Повреждён файл позиций, начинаем с конца файлов")

    def save(self):
        self._state_file.parent.mkdir(parents=True, exist_ok=True)
        data = {
            path: {"path": s.path, "inode": s.inode, "offset": s.offset}
            for path, s in self._positions.items()
        }
        self._state_file.write_text(json.dumps(data, indent=2))

    def get(self, path: str) -> Optional[FileState]:
        return self._positions.get(path)

    def update(self, path: str, inode: int, offset: int):
        self._positions[path] = FileState(path=path, inode=inode, offset=offset)


class FileTailer:
    """
    Отслеживает файлы логов аналогично tail -f.
    Обрабатывает ротацию (inode change) и дочитывает новые строки.
    """

    def __init__(
        self,
        paths: list[str],
        callback: LogCallback,
        tracker: PositionTracker,
        poll_interval: float = 1.0,
    ):
        self._paths = paths
        self._callback = callback
        self._tracker = tracker
        self._poll_interval = poll_interval
        self._handles: dict[str, _OpenFile] = {}
        self._running = False

    def start(self):
        self._running = True
        self._open_files()

        while self._running:
            for path in self._paths:
                self._read_new_lines(path)
            self._tracker.save()
            time.sleep(self._poll_interval)

    def stop(self):
        self._running = False
        for handle in self._handles.values():
            handle.close()

    def _open_files(self):
        for path in self._paths:
            if not os.path.exists(path):
                logger.debug("Файл %s не найден, пропускаем", path)
                continue
            self._open_single(path)

    def _open_single(self, path: str):
        try:
            stat = os.stat(path)
        except OSError as e:
            logger.warning("Не удалось получить stat для %s: %s", path, e)
            return

        saved = self._tracker.get(path)

        # Если inode совпадает — продолжаем с сохранённой позиции
        if saved and saved.inode == stat.st_ino:
            offset = min(saved.offset, stat.st_size)
        else:
            # Новый файл или ротация — читаем с конца (чтобы не слать старые логи)
            offset = stat.st_size

        fh = open(path, "r", encoding="utf-8", errors="replace")
        fh.seek(offset)
        self._handles[path] = _OpenFile(fh=fh, inode=stat.st_ino)
        self._tracker.update(path, stat.st_ino, offset)

    def _read_new_lines(self, path: str):
        if path not in self._handles:
            if os.path.exists(path):
                self._open_single(path)
            return

        handle = self._handles[path]

        # Проверяем ротацию: inode изменился — переоткрываем
        try:
            current_stat = os.stat(path)
        except OSError:
            return

        if current_stat.st_ino != handle.inode:
            logger.info("Обнаружена ротация %s, переоткрываем", path)
            handle.close()
            del self._handles[path]
            self._open_single(path)
            # После ротации начинаем с начала нового файла
            if path in self._handles:
                self._handles[path].fh.seek(0)
                self._tracker.update(path, current_stat.st_ino, 0)
            return

        # Файл мог быть truncated (logrotate copytruncate)
        if current_stat.st_size < handle.fh.tell():
            logger.info("Файл %s усечён, сбрасываем позицию", path)
            handle.fh.seek(0)

        for line in handle.fh:
            line = line.rstrip("\n\r")
            if not line:
                continue
            parsed = parse_line(line, source_file=path)
            self._callback(parsed)

        self._tracker.update(path, handle.inode, handle.fh.tell())


class _OpenFile:
    def __init__(self, fh, inode: int):
        self.fh = fh
        self.inode = inode

    def close(self):
        try:
            self.fh.close()
        except OSError:
            pass


class JournaldReader:
    """
    Читает записи из systemd journal.
    Требует пакет systemd-python (доступен внутри Linux-контейнера).
    """

    def __init__(
        self,
        callback: LogCallback,
        tracker: PositionTracker,
        poll_interval: float = 1.0,
    ):
        self._callback = callback
        self._tracker = tracker
        self._poll_interval = poll_interval
        self._running = False
        self._cursor_file = Path("/var/lib/log-agent/journal_cursor")

    def start(self):
        try:
            from systemd import journal  # type: ignore[import-untyped]
        except ImportError:
            logger.warning(
                "systemd-python не установлен — journald чтение отключено. "
                "Установите: pip install systemd-python"
            )
            return

        self._running = True
        reader = journal.Reader()
        reader.log_level(journal.LOG_DEBUG)

        saved_cursor = self._load_cursor()
        if saved_cursor:
            try:
                reader.seek_cursor(saved_cursor)
                reader.get_next()  # пропускаем уже прочитанную запись
            except Exception:
                logger.warning("Не удалось восстановить cursor, читаем с хвоста")
                reader.seek_tail()
                reader.get_previous()

        else:
            reader.seek_tail()
            reader.get_previous()

        while self._running:
            for entry in reader:
                parsed = parse_journald_entry(entry)
                self._callback(parsed)
                cursor = entry.get("__CURSOR", "")
                if cursor:
                    self._save_cursor(cursor)

            time.sleep(self._poll_interval)

    def stop(self):
        self._running = False

    def _load_cursor(self) -> Optional[str]:
        if self._cursor_file.exists():
            return self._cursor_file.read_text().strip()
        return None

    def _save_cursor(self, cursor: str):
        if not cursor:
            return
        self._cursor_file.parent.mkdir(parents=True, exist_ok=True)
        self._cursor_file.write_text(cursor)
