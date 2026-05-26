#!/usr/bin/env python3
"""
Локальный запуск: парсинг логов Ubuntu с выводом в консоль.
Не требует OpenSearch, Docker, внешних зависимостей.

Запуск:
    sudo python3 run_local.py
    sudo python3 run_local.py --files /var/log/syslog /var/log/auth.log
    sudo python3 run_local.py --tail     # только новые строки (как tail -f)
    sudo python3 run_local.py --last 50  # последние 50 строк из каждого файла
"""

from __future__ import annotations

import argparse
import os
import signal
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from src.parser import parse_line, LogLevel

# ── ANSI-цвета ───────────────────────────────────────────────────────────

COLORS = {
    LogLevel.EMERGENCY: "\033[1;97;41m",   # белый на красном
    LogLevel.ALERT:     "\033[1;91m",       # ярко-красный
    LogLevel.CRITICAL:  "\033[1;91m",       # ярко-красный
    LogLevel.ERROR:     "\033[31m",         # красный
    LogLevel.WARNING:   "\033[33m",         # жёлтый
    LogLevel.NOTICE:    "\033[36m",         # циан
    LogLevel.INFO:      "\033[0m",          # обычный
    LogLevel.DEBUG:     "\033[90m",         # серый
}
RESET = "\033[0m"
BOLD = "\033[1m"

LABELS = {
    LogLevel.EMERGENCY: "EMERG  ",
    LogLevel.ALERT:     "ALERT  ",
    LogLevel.CRITICAL:  "CRIT   ",
    LogLevel.ERROR:     "ERROR  ",
    LogLevel.WARNING:   "WARN   ",
    LogLevel.NOTICE:    "NOTICE ",
    LogLevel.INFO:      "INFO   ",
    LogLevel.DEBUG:     "DEBUG  ",
}

DEFAULT_FILES = [
    "/var/log/syslog",
    "/var/log/auth.log",
    "/var/log/kern.log",
    "/var/log/daemon.log",
]

# ── Статистика ───────────────────────────────────────────────────────────

stats: dict[str, int] = {level.value: 0 for level in LogLevel}
total_lines = 0


def print_log(line: str, source: str):
    global total_lines
    parsed = parse_line(line, source_file=source)
    total_lines += 1
    stats[parsed.level.value] += 1

    color = COLORS[parsed.level]
    label = LABELS[parsed.level]
    short_source = os.path.basename(source)

    print(
        f"{color}[{label}] "
        f"{BOLD}{parsed.timestamp}{RESET}{color} "
        f"{short_source}:{parsed.service}"
        f"{'[' + str(parsed.pid) + ']' if parsed.pid else ''}: "
        f"{parsed.message}{RESET}"
    )


def print_stats():
    print(f"\n{BOLD}{'=' * 60}")
    print(f"  Итого обработано: {total_lines} строк")
    print(f"{'=' * 60}{RESET}")
    for level in LogLevel:
        count = stats[level.value]
        if count == 0:
            continue
        color = COLORS[level]
        bar = "#" * min(count, 50)
        print(f"  {color}{LABELS[level]}{RESET} {count:>6}  {color}{bar}{RESET}")
    print()


# ── Режим чтения существующих строк ──────────────────────────────────────

def read_last_lines(filepath: str, n: int) -> list[str]:
    """Читает последние n строк файла (эффективно, без загрузки всего файла)."""
    try:
        with open(filepath, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            block_size = min(size, 8192)
            data = b""
            blocks_read = 0
            while len(data.split(b"\n")) <= n + 1 and blocks_read * block_size < size:
                blocks_read += 1
                offset = max(0, size - blocks_read * block_size)
                f.seek(offset)
                data = f.read(size - offset)

            lines = data.decode("utf-8", errors="replace").splitlines()
            return lines[-n:] if len(lines) > n else lines
    except PermissionError:
        print(f"\033[31m  Нет доступа к {filepath} — запусти с sudo\033[0m")
        return []
    except FileNotFoundError:
        return []


def process_existing(files: list[str], last_n: int):
    """Читает последние N строк из каждого файла."""
    for filepath in files:
        if not os.path.exists(filepath):
            continue

        print(f"\n{BOLD}── {filepath} (последние {last_n} строк) ──{RESET}")
        lines = read_last_lines(filepath, last_n)
        for line in lines:
            line = line.strip()
            if line:
                print_log(line, filepath)


# ── Режим tail (отслеживание новых строк) ────────────────────────────────

def tail_files(files: list[str], poll_interval: float = 0.5):
    """Отслеживает новые строки во всех файлах (аналог tail -f)."""
    handles: dict[str, tuple] = {}

    for filepath in files:
        if not os.path.exists(filepath):
            print(f"\033[90m  Пропущен: {filepath} (не найден)\033[0m")
            continue
        try:
            fh = open(filepath, "r", encoding="utf-8", errors="replace")
            fh.seek(0, 2)  # перемотка в конец
            handles[filepath] = (fh, os.stat(filepath).st_ino)
            print(f"\033[32m  Отслеживаю: {filepath}\033[0m")
        except PermissionError:
            print(f"\033[31m  Нет доступа к {filepath} — запусти с sudo\033[0m")

    if not handles:
        print("\033[31mНет доступных файлов для отслеживания.\033[0m")
        return

    print(f"\n{BOLD}Жду новые записи... (Ctrl+C для выхода){RESET}\n")

    running = True

    def stop(sig, frame):
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    while running:
        for filepath, (fh, inode) in list(handles.items()):
            try:
                current_inode = os.stat(filepath).st_ino
            except OSError:
                continue

            # ротация лога
            if current_inode != inode:
                fh.close()
                try:
                    fh = open(filepath, "r", encoding="utf-8", errors="replace")
                    handles[filepath] = (fh, current_inode)
                except (PermissionError, OSError):
                    del handles[filepath]
                continue

            for raw_line in fh:
                line = raw_line.strip()
                if line:
                    print_log(line, filepath)

        time.sleep(poll_interval)

    for fh, _ in handles.values():
        fh.close()


# ── Main ─────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(
        description="Локальный парсер логов Ubuntu с цветным выводом"
    )
    ap.add_argument(
        "--files", nargs="+", default=DEFAULT_FILES,
        help="Файлы логов для чтения"
    )
    ap.add_argument(
        "--tail", action="store_true",
        help="Режим отслеживания (tail -f): показывать только новые строки"
    )
    ap.add_argument(
        "--last", type=int, default=30,
        help="Количество последних строк из каждого файла (по умолчанию 30)"
    )
    args = ap.parse_args()

    existing = [f for f in args.files if os.path.exists(f)]
    missing = [f for f in args.files if not os.path.exists(f)]

    print(f"{BOLD}Логовизор — локальный парсер логов{RESET}")
    print(f"Найдено файлов: {len(existing)}/{len(args.files)}")
    if missing:
        for m in missing:
            print(f"\033[90m  Не найден: {m}\033[0m")
    print()

    if not existing:
        print("\033[31mНет доступных файлов. Проверь пути или запусти с sudo.\033[0m")
        sys.exit(1)

    if args.tail:
        process_existing(existing, last_n=5)
        print_stats()
        tail_files(existing)
        print_stats()
    else:
        process_existing(existing, last_n=args.last)
        print_stats()


if __name__ == "__main__":
    main()
