"""
Точка входа агента сбора логов.

Запуск:
    python -m src.main
    python -m src.main --config /path/to/config.yml
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
import threading

import yaml

from .collector import FileTailer, JournaldReader, PositionTracker
from .buffer import LogBuffer
from .sender import OpenSearchSender
from .parser import ParsedLog

logger = logging.getLogger("log-agent")

DEFAULT_CONFIG = {
    "agent": {
        "hostname": None,  # auto-detect
        "log_level": "INFO",
        "state_dir": "/var/lib/log-agent",
    },
    "inputs": {
        "files": [
            "/var/log/syslog",
            "/var/log/auth.log",
            "/var/log/kern.log",
            "/var/log/daemon.log",
        ],
        "journald": True,
        "poll_interval": 1.0,
    },
    "buffer": {
        "max_size_mb": 512,
    },
    "output": {
        "host": "https://opensearch:9200",
        "user": "admin",
        "password": "admin",
        "index_prefix": "logs",
        "verify_ssl": False,
        "batch_size": 200,
        "flush_interval": 5.0,
    },
}


def load_config(path: str | None) -> dict:
    config = DEFAULT_CONFIG.copy()

    if path and os.path.exists(path):
        with open(path, "r") as f:
            user_config = yaml.safe_load(f) or {}
        config = _deep_merge(config, user_config)

    # env-переменные имеют приоритет
    env_map = {
        "AGENT_HOSTNAME": ("agent", "hostname"),
        "AGENT_LOG_LEVEL": ("agent", "log_level"),
        "OPENSEARCH_HOST": ("output", "host"),
        "OPENSEARCH_USER": ("output", "user"),
        "OPENSEARCH_PASSWORD": ("output", "password"),
        "OPENSEARCH_INDEX_PREFIX": ("output", "index_prefix"),
        "OPENSEARCH_VERIFY_SSL": ("output", "verify_ssl"),
    }
    for env_key, (section, key) in env_map.items():
        val = os.environ.get(env_key)
        if val is not None:
            if key == "verify_ssl":
                val = val.lower() in ("true", "1", "yes")
            config[section][key] = val

    return config


def _deep_merge(base: dict, override: dict) -> dict:
    result = base.copy()
    for key, val in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = _deep_merge(result[key], val)
        else:
            result[key] = val
    return result


def main():
    parser = argparse.ArgumentParser(description="Log Agent — сборщик логов Linux")
    parser.add_argument("--config", "-c", default="/etc/log-agent/config.yml")
    args = parser.parse_args()

    config = load_config(args.config)

    logging.basicConfig(
        level=getattr(logging, config["agent"]["log_level"].upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        stream=sys.stdout,
    )

    hostname = config["agent"]["hostname"] or os.uname().nodename
    state_dir = config["agent"]["state_dir"]

    logger.info("Запуск агента на хосте: %s", hostname)
    logger.info("Отслеживаемые файлы: %s", config["inputs"]["files"])
    logger.info("Journald: %s", "включён" if config["inputs"]["journald"] else "выключен")

    # ── Компоненты ──
    buffer = LogBuffer(
        db_path=os.path.join(state_dir, "buffer.db"),
        max_size_mb=config["buffer"]["max_size_mb"],
    )

    sender = OpenSearchSender(
        host=config["output"]["host"],
        user=config["output"]["user"],
        password=config["output"]["password"],
        index_prefix=config["output"]["index_prefix"],
        verify_ssl=config["output"]["verify_ssl"],
        batch_size=config["output"]["batch_size"],
        flush_interval=config["output"]["flush_interval"],
        buffer=buffer,
    )

    tracker = PositionTracker(
        state_file=os.path.join(state_dir, "positions.json")
    )

    def on_log(log: ParsedLog):
        if not log.hostname or log.hostname == "unknown":
            log.hostname = hostname
        sender.send(log)

    # ── Запуск ──
    sender.start_background()

    threads: list[threading.Thread] = []

    existing_files = [f for f in config["inputs"]["files"] if os.path.exists(f)]
    if existing_files:
        tailer = FileTailer(
            paths=existing_files,
            callback=on_log,
            tracker=tracker,
            poll_interval=config["inputs"]["poll_interval"],
        )
        t = threading.Thread(target=tailer.start, name="file-tailer", daemon=True)
        t.start()
        threads.append(t)
        logger.info("FileTailer запущен для %d файлов", len(existing_files))
    else:
        tailer = None
        logger.warning("Ни один из указанных файлов не найден")

    if config["inputs"]["journald"]:
        journal_reader = JournaldReader(
            callback=on_log,
            tracker=tracker,
            poll_interval=config["inputs"]["poll_interval"],
        )
        t = threading.Thread(target=journal_reader.start, name="journald", daemon=True)
        t.start()
        threads.append(t)
        logger.info("JournaldReader запущен")
    else:
        journal_reader = None

    # ── Graceful shutdown ──
    shutdown_event = threading.Event()

    def handle_signal(signum, frame):
        logger.info("Получен сигнал %d, завершаем...", signum)
        shutdown_event.set()
        if tailer:
            tailer.stop()
        if journal_reader:
            journal_reader.stop()
        sender.stop()
        buffer.close()
        tracker.save()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    shutdown_event.wait()
    logger.info("Агент остановлен")


if __name__ == "__main__":
    main()
