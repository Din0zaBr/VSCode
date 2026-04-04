"""
Ursus Insight SIEM - Log Collector
Sources:
  1. UDP Syslog listener (port 514 / 1514)
  2. File tail watcher
  3. Ingest queue (from agent API / demo generator)
"""
import os
import re
import sys
import time
import socket
import threading
import queue
import logging
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import config
from core import parser, database

logger = logging.getLogger("ursus.collector")

# Shared ingest queue: (raw_line, source_ip, agent_id)
ingest_queue: queue.Queue = queue.Queue(maxsize=10000)


# ── Syslog UDP Listener ───────────────────────────────────────────────────────

class SyslogListener(threading.Thread):
    def __init__(self, host=None, port=None):
        super().__init__(daemon=True, name="SyslogListener")
        self.host = host or config.SYSLOG_HOST
        self.port = port or config.SYSLOG_UDP_PORT
        self._stop = threading.Event()

    def run(self):
        # Try privileged port first, fall back to 1514
        for port in (self.port, config.SYSLOG_TCP_PORT):
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind((self.host, port))
                sock.settimeout(1.0)
                logger.info("Syslog UDP listening on %s:%d", self.host, port)
                self._sock = sock
                self._active_port = port
                break
            except OSError as e:
                logger.warning("Cannot bind syslog on port %d: %s", port, e)
        else:
            logger.error("Syslog listener disabled (no available port)")
            return

        while not self._stop.is_set():
            try:
                data, addr = self._sock.recvfrom(65535)
                raw = data.decode("utf-8", errors="replace").strip()
                if raw:
                    try:
                        ingest_queue.put_nowait((raw, addr[0], None))
                    except queue.Full:
                        logger.warning("Ingest queue full, dropping syslog event")
            except socket.timeout:
                continue
            except Exception as e:
                logger.error("Syslog recv error: %s", e)

    def stop(self):
        self._stop.set()

    @property
    def active_port(self):
        return getattr(self, "_active_port", None)


# ── File Tail Watcher ─────────────────────────────────────────────────────────

class FileTailWatcher(threading.Thread):
    def __init__(self, paths=None):
        super().__init__(daemon=True, name="FileTailWatcher")
        self.paths = paths or config.LOG_WATCH_PATHS
        self._stop = threading.Event()
        self._positions = {}

    def _get_source_ip(self, path):
        # Treat local files as localhost
        return "127.0.0.1"

    def _tail_file(self, path):
        if not os.path.isfile(path):
            return
        try:
            stat = os.stat(path)
            if path not in self._positions:
                # Start from end on first run
                self._positions[path] = stat.st_size
                return
            pos = self._positions[path]
            if stat.st_size < pos:
                # File rotated
                pos = 0
            with open(path, "r", errors="replace") as f:
                f.seek(pos)
                for line in f:
                    line = line.rstrip()
                    if line:
                        try:
                            ingest_queue.put_nowait((line, self._get_source_ip(path), None))
                        except queue.Full:
                            pass
                self._positions[path] = f.tell()
        except (IOError, PermissionError) as e:
            logger.debug("Cannot read %s: %s", path, e)

    def run(self):
        logger.info("File watcher started for %d paths", len(self.paths))
        while not self._stop.is_set():
            for path in self.paths:
                self._tail_file(path)
            time.sleep(2)

    def stop(self):
        self._stop.set()


# ── Event Processor ───────────────────────────────────────────────────────────

class EventProcessor(threading.Thread):
    """Drains ingest_queue, parses events, writes to DB."""

    def __init__(self):
        super().__init__(daemon=True, name="EventProcessor")
        self._stop = threading.Event()
        self._batch = []
        self._batch_size = 50
        self._flush_interval = 1.0

    def run(self):
        logger.info("Event processor started")
        last_flush = time.time()
        while not self._stop.is_set():
            try:
                raw, src_ip, agent_id = ingest_queue.get(timeout=0.5)
                self._process(raw, src_ip, agent_id)
            except queue.Empty:
                pass
            if time.time() - last_flush > self._flush_interval:
                last_flush = time.time()

    def _process(self, raw: str, src_ip: str, agent_id: str):
        try:
            event = parser.parse_log_line(raw, source_ip=src_ip)
            if not event:
                return
            if src_ip and not event.get("source_ip"):
                event["source_ip"] = src_ip
            database.insert_event(
                source_ip=event.get("source_ip"),
                source_host=event.get("source_host"),
                category=event.get("category", "Other"),
                severity=event.get("severity", "INFO"),
                event_type=event.get("event_type", "generic"),
                raw_message=event["raw_message"],
                parsed=event.get("parsed"),
                timestamp=event.get("timestamp"),
                agent_id=agent_id,
            )
        except Exception as e:
            logger.error("Error processing event: %s | raw=%s", e, raw[:100])

    def stop(self):
        self._stop.set()


# ── Demo Event Generator (for testing without real VMs) ──────────────────────

DEMO_EVENTS = [
    ('<134>1 {ts} webserver01 sshd 1234 - - Failed password for admin from 192.168.10.50 port 22 ssh2', "192.168.10.50"),
    ('<134>1 {ts} webserver01 sshd 1234 - - Failed password for root from 10.0.0.5 port 22 ssh2', "10.0.0.5"),
    ('<86>1 {ts} db-server sudo 999 - - user1 : TTY=pts/0 ; PWD=/home/user1 ; USER=root ; COMMAND=/bin/bash', "10.0.0.10"),
    ('<134>1 {ts} fileserver sshd 5678 - - Accepted password for deploy from 172.16.0.20 port 22 ssh2', "172.16.0.20"),
    ('<134>1 {ts} webserver01 nginx - - - 192.168.1.100 - - "GET /admin HTTP/1.1" 404 512', "192.168.1.100"),
    ('<134>1 {ts} firewall kernel - - - IPTABLES DROP IN=eth0 SRC=45.33.32.156 DST=10.0.0.1 DPT=3389', "45.33.32.156"),
    ('<134>1 {ts} workstation01 passwd - - - new user: name=hacker, UID=1001', "10.0.0.50"),
    ('<134>1 {ts} ids-sensor snort - - - INTRUSION DETECTED: Port scan from 192.168.5.99 to multiple ports', "192.168.5.99"),
    ('<134>1 {ts} mailserver postfix - - - connection refused from unknown[203.0.113.5]', "203.0.113.5"),
    ('<86>1 {ts} webserver01 apache2 - - - EventID:4625 Logon Failure Account: administrator Source: 10.10.10.10', "10.10.10.10"),
    ('<134>1 {ts} db-server mysql - - - Access denied for user root@10.0.0.20', "10.0.0.20"),
    ('<134>1 {ts} webserver01 kernel - - - UFW BLOCK IN=eth0 SRC=1.2.3.4 DST=10.0.0.1 DPT=22', "1.2.3.4"),
    ('<14>1 {ts} sensor01 suricata - - - ALERT: Malware C2 beacon detected from 192.168.100.5', "192.168.100.5"),
    ('<134>1 {ts} webserver01 sshd 2222 - - Accepted publickey for deploy from 10.0.1.5 port 55432', "10.0.1.5"),
    ('<86>1 {ts} dc01 system - - - EventID:4720 New user account created: SamAccountName=backdoor', "10.0.0.100"),
]

import random

class DemoEventGenerator(threading.Thread):
    """Generates synthetic log events for demo/testing purposes."""

    def __init__(self, interval_range=(2, 8)):
        super().__init__(daemon=True, name="DemoGenerator")
        self.interval_range = interval_range
        self._stop = threading.Event()

    def run(self):
        logger.info("Demo event generator started")
        # Generate initial burst
        for _ in range(20):
            self._emit()
        while not self._stop.is_set():
            interval = random.uniform(*self.interval_range)
            self._stop.wait(interval)
            if not self._stop.is_set():
                self._emit()

    def _emit(self):
        template, src_ip = random.choice(DEMO_EVENTS)
        ts = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
        raw = template.format(ts=ts)
        try:
            ingest_queue.put_nowait((raw, src_ip, "demo"))
        except queue.Full:
            pass

    def stop(self):
        self._stop.set()


# ── Public API ────────────────────────────────────────────────────────────────

def submit_event(raw: str, source_ip: str = None, agent_id: str = None):
    """Called by the agent API to submit events directly."""
    try:
        ingest_queue.put_nowait((raw, source_ip, agent_id))
        return True
    except queue.Full:
        return False


def queue_size():
    return ingest_queue.qsize()
