"""
Быстрый тест парсера логов.
Запуск: python test_parser.py
"""

import sys
import os
import json
from datetime import datetime

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

from src.parser import parse_line, parse_journald_entry, LogLevel

SAMPLE_LOGS = [
    # ── syslog (Ubuntu /var/log/syslog) ──
    (
        "Mar 20 14:23:45 web-server-01 nginx[1234]: 200 GET /api/health 0.002s",
        "/var/log/syslog",
    ),
    (
        "Mar 20 14:23:46 web-server-01 sshd[5678]: Failed password for root from 192.168.1.100 port 22 ssh2",
        "/var/log/auth.log",
    ),
    (
        "Mar 20 14:23:47 web-server-01 CRON[9012]: (root) CMD (/usr/bin/certbot renew)",
        "/var/log/syslog",
    ),

    # ── auth.log ──
    (
        "Mar 20 15:00:01 db-server sshd[3456]: Accepted publickey for admin from 10.0.0.5 port 54321 ssh2",
        "/var/log/auth.log",
    ),
    (
        "Mar 20 15:01:22 db-server sudo[7890]:   admin : TTY=pts/0 ; PWD=/root ; COMMAND=/bin/systemctl restart postgresql",
        "/var/log/auth.log",
    ),

    # ── kern.log ──
    (
        "Mar 20 14:30:00 web-server-01 kernel: [123456.789012] EXT4-fs error (device sda1): ext4_lookup: deleted inode referenced",
        "/var/log/kern.log",
    ),
    (
        "Mar 20 14:30:01 web-server-01 kernel: [123457.000000] Out of memory: Killed process 4567 (java) total-vm:2048000kB",
        "/var/log/kern.log",
    ),

    # ── daemon.log ──
    (
        "Mar 20 16:00:00 app-server systemd[1]: Started PostgreSQL Cluster 15-main.",
        "/var/log/daemon.log",
    ),
    (
        "Mar 20 16:05:33 app-server dockerd[2345]: level=warning msg=\"failed to retrieve runc version\"",
        "/var/log/daemon.log",
    ),

    # ── RED OS /var/log/messages ──
    (
        "Mar 20 17:00:00 redos-server NetworkManager[890]: <warn>  [1710950400.1234] device (eth0): link disconnected",
        "/var/log/messages",
    ),
    (
        "Mar 20 17:00:01 redos-server systemd[1]: Failed to start Firewalld.",
        "/var/log/messages",
    ),

    # ── RED OS /var/log/secure ──
    (
        "Mar 20 17:10:00 redos-server sshd[1111]: error: PAM: Authentication failure for user test from 192.168.1.200",
        "/var/log/secure",
    ),

    # ── Нераспознаваемая строка (fallback) ──
    (
        "Something completely unexpected happened here",
        "/var/log/custom.log",
    ),
]

SAMPLE_JOURNALD = {
    "MESSAGE": "Unit docker.service entered failed state.",
    "_HOSTNAME": "kali-box",
    "SYSLOG_IDENTIFIER": "systemd",
    "_PID": "1",
    "PRIORITY": "3",
    "__REALTIME_TIMESTAMP": datetime(2026, 3, 20, 18, 0, 0),
    "_SYSTEMD_UNIT": "docker.service",
    "_TRANSPORT": "journal",
    "__CURSOR": "s=abc123",
}


def colorize(level: LogLevel) -> str:
    colors = {
        LogLevel.EMERGENCY: "\033[91;1m",
        LogLevel.ALERT:     "\033[91;1m",
        LogLevel.CRITICAL:  "\033[91m",
        LogLevel.ERROR:     "\033[31m",
        LogLevel.WARNING:   "\033[33m",
        LogLevel.NOTICE:    "\033[36m",
        LogLevel.INFO:      "\033[32m",
        LogLevel.DEBUG:     "\033[37m",
    }
    reset = "\033[0m"
    return f"{colors.get(level, '')}{level.value:>10}{reset}"


def main():
    print("=" * 80)
    print("  ТЕСТ ПАРСЕРА ЛОГОВ")
    print("=" * 80)

    stats = {level: 0 for level in LogLevel}

    for raw_line, source in SAMPLE_LOGS:
        parsed = parse_line(raw_line, source_file=source)
        stats[parsed.level] += 1

        print(f"\n{'─' * 80}")
        print(f"  Источник : {source}")
        print(f"  Raw      : {raw_line[:90]}{'...' if len(raw_line) > 90 else ''}")
        print(f"  ────────────────────────────────")
        print(f"  Время    : {parsed.timestamp}")
        print(f"  Хост     : {parsed.hostname}")
        print(f"  Сервис   : {parsed.service}")
        print(f"  PID      : {parsed.pid or '—'}")
        print(f"  Уровень  : {colorize(parsed.level)}")
        print(f"  Сообщение: {parsed.message[:80]}{'...' if len(parsed.message) > 80 else ''}")
        if parsed.extra:
            print(f"  Extra    : {parsed.extra}")

    # journald
    print(f"\n{'─' * 80}")
    print(f"  [JOURNALD ENTRY]")
    jparsed = parse_journald_entry(SAMPLE_JOURNALD)
    stats[jparsed.level] += 1
    print(f"  Время    : {jparsed.timestamp}")
    print(f"  Хост     : {jparsed.hostname}")
    print(f"  Сервис   : {jparsed.service}")
    print(f"  Уровень  : {colorize(jparsed.level)}")
    print(f"  Сообщение: {jparsed.message}")
    print(f"  Extra    : {jparsed.extra}")

    # Статистика
    print(f"\n{'=' * 80}")
    print("  СТАТИСТИКА")
    print(f"{'=' * 80}")
    total = sum(stats.values())
    for level in LogLevel:
        count = stats[level]
        if count > 0:
            bar = "█" * (count * 3)
            print(f"  {colorize(level)}  {count:>2}  {bar}")
    print(f"  {'':>10}  ──")
    print(f"  {'ВСЕГО':>10}  {total}")

    # JSON-вывод одного лога
    print(f"\n{'=' * 80}")
    print("  ПРИМЕР JSON (как отправляется в OpenSearch)")
    print(f"{'=' * 80}")
    sample = parse_line(SAMPLE_LOGS[1][0], source_file=SAMPLE_LOGS[1][1])
    print(json.dumps(sample.to_dict(), indent=2, ensure_ascii=False))

    print()


if __name__ == "__main__":
    main()
