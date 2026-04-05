from __future__ import annotations

import logging
import signal
import socket
import sys
import threading
import time
from typing import NoReturn

from agent.src.buffer import LocalBuffer
from agent.src.config import AgentConfig, load_config
from agent.src.models import LogEvent
from agent.src.readers.base import LogReader
from agent.src.readers.file_reader import FileReader
from agent.src.readers.journald_reader import JournaldReader
from agent.src.transport.http import HttpTransport

# Windows Event Log reader — available only on Windows with pywin32 installed
try:
    from agent.src.readers.winevent_reader import WinEventReader as _WinEventReader
    _WINEVENT_AVAILABLE = True
except (ImportError, RuntimeError):
    _WinEventReader = None  # type: ignore[assignment,misc]
    _WINEVENT_AVAILABLE = False

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("agent")

shutdown_event = threading.Event()


def build_readers(cfg: AgentConfig) -> list[LogReader]:
    readers: list[LogReader] = []
    for src in cfg.sources:
        if src.type == "file":
            if not src.path:
                logger.warning("file source missing 'path', skipping")
                continue
            readers.append(FileReader(path=src.path, service=src.service))

        elif src.type == "journald":
            readers.append(JournaldReader(unit=src.unit, service=src.service))

        elif src.type == "winevent":
            if not _WINEVENT_AVAILABLE:
                logger.warning(
                    "winevent source requested (channel=%s) but pywin32 is not installed. "
                    "Run: pip install pywin32 && python Scripts/pywin32_postinstall.py -install",
                    src.channel,
                )
                continue
            readers.append(
                _WinEventReader(  # type: ignore[misc]
                    channel=src.channel,
                    service=src.service or "windows",
                    event_ids=list(src.event_ids) if src.event_ids else None,
                )
            )

        else:
            logger.warning("Unknown source type: %s", src.type)
    return readers


def reader_worker(
    reader: LogReader,
    buffer: LocalBuffer,
    batch: list[LogEvent],
    batch_lock: threading.Lock,
    agent_id: str,
    hostname: str,
) -> None:
    try:
        for event in reader.read():
            if shutdown_event.is_set():
                break
            event.agent_id = agent_id
            event.host = hostname
            with batch_lock:
                batch.append(event)
    except Exception:
        logger.exception("Reader %s crashed", reader.source)


def flush_worker(
    transport: HttpTransport,
    buffer: LocalBuffer,
    batch: list[LogEvent],
    batch_lock: threading.Lock,
    cfg: AgentConfig,
) -> None:
    while not shutdown_event.is_set():
        time.sleep(cfg.flush_interval)

        with batch_lock:
            current = list(batch)
            batch.clear()

        if current:
            ok = transport.send(current)
            if not ok:
                logger.warning("Server unreachable, buffering %d events", len(current))
                buffer.push(current)

        buffered = buffer.peek(cfg.batch_size)
        if buffered:
            ids = [row_id for row_id, _ in buffered]
            events = [ev for _, ev in buffered]
            if transport.send(events):
                buffer.delete(ids)
                logger.info("Flushed %d buffered events", len(ids))


def main() -> NoReturn:
    config_path = sys.argv[1] if len(sys.argv) > 1 else "/etc/logvault/config.yaml"
    cfg = load_config(config_path)
    hostname = cfg.hostname or socket.gethostname()
    logger.info("Agent %s starting on %s", cfg.agent_id, hostname)

    buffer = LocalBuffer(cfg.buffer_db)
    transport = HttpTransport(
        server_url=cfg.server_url,
        agent_id=cfg.agent_id,
        api_key=cfg.api_key,
        retry_base=cfg.retry_base,
        retry_max=cfg.retry_max,
    )
    readers = build_readers(cfg)
    if not readers:
        logger.error("No log sources configured. Exiting.")
        sys.exit(1)

    batch: list[LogEvent] = []
    batch_lock = threading.Lock()

    def _shutdown(signum, frame):
        logger.info("Shutting down (signal %s)...", signum)
        shutdown_event.set()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    threads: list[threading.Thread] = []
    for reader in readers:
        t = threading.Thread(
            target=reader_worker,
            args=(reader, buffer, batch, batch_lock, cfg.agent_id, hostname),
            daemon=True,
        )
        t.start()
        threads.append(t)
        logger.info("Started reader: %s", reader.source)

    flusher = threading.Thread(
        target=flush_worker,
        args=(transport, buffer, batch, batch_lock, cfg),
        daemon=True,
    )
    flusher.start()
    logger.info("Flush worker started (interval=%.1fs, batch=%d)", cfg.flush_interval, cfg.batch_size)

    shutdown_event.wait()

    for reader in readers:
        reader.close()
    transport.close()
    logger.info("Agent stopped.")
    sys.exit(0)


if __name__ == "__main__":
    main()
