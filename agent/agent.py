#!/usr/bin/env python3
"""
Ursus Insight SIEM — Collection Agent
Deploy this script on monitored VMs (Linux / Windows).

Usage:
    python3 agent.py --server http://SIEM_IP:8080 --key YOUR_API_KEY [options]

Options:
    --server    SIEM server URL          (required)
    --key       Agent API key            (required)
    --id        Agent ID                 (default: hostname)
    --interval  Send interval (seconds)  (default: 10)
    --logs      Comma-separated log file paths to watch
    --channels  Windows Event channels   (default: Security,System,Application)
    --no-winapi Use PowerShell fallback instead of pywin32

Windows quick-start (run as Administrator):
    pip install requests psutil pywin32
    python agent.py --server http://SIEM_IP:8080 --key YOUR_KEY

Run as Windows service (NSSM):
    nssm install UrsusAgent "C:\\Python312\\python.exe" "C:\\ursus\\agent.py --server ... --key ..."
    nssm start UrsusAgent

Run as Windows service (sc.exe via wrapper - see install_service() below):
    python agent.py --install-service --server ... --key ...
"""
import os
import sys
import time
import json
import uuid
import socket
import logging
import argparse
import platform
import threading
import queue
import re
from datetime import datetime

try:
    import requests
except ImportError:
    print("[ERROR] Install requests: pip3 install requests")
    sys.exit(1)

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

# ── Config ────────────────────────────────────────────────────────────────────

VERSION = "1.0.0"
AGENT_ID = None
SIEM_SERVER = None
API_KEY = None
SEND_INTERVAL = 10
LOG_PATHS = []

# Default log paths by OS
DEFAULT_LOGS_LINUX = [
    "/var/log/syslog", "/var/log/auth.log", "/var/log/kern.log",
    "/var/log/messages", "/var/log/secure",
    "/var/log/nginx/access.log", "/var/log/nginx/error.log",
    "/var/log/apache2/access.log",
]
DEFAULT_LOGS_WINDOWS = [
    "C:/Windows/System32/winevt/Logs/Security.evtx",
    "C:/Windows/System32/winevt/Logs/Application.evtx",
]

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("ursus-agent")

# ── Event queue ───────────────────────────────────────────────────────────────

event_queue: queue.Queue = queue.Queue(maxsize=5000)


def enqueue(line: str):
    try:
        event_queue.put_nowait(line.strip())
    except queue.Full:
        pass


# ── File Tailer ───────────────────────────────────────────────────────────────

class FileTailer(threading.Thread):
    def __init__(self, paths):
        super().__init__(daemon=True, name="FileTailer")
        self.paths = paths
        self._positions = {}
        self._stop = threading.Event()

    def run(self):
        logger.info("Watching %d log files", len(self.paths))
        while not self._stop.is_set():
            for path in self.paths:
                self._tail(path)
            self._stop.wait(2)

    def _tail(self, path):
        if not os.path.isfile(path):
            return
        try:
            stat = os.stat(path)
            if path not in self._positions:
                self._positions[path] = stat.st_size
                return
            pos = self._positions[path]
            if stat.st_size < pos:
                pos = 0
            with open(path, "r", errors="replace") as f:
                f.seek(pos)
                for line in f:
                    if line.strip():
                        enqueue(line)
                self._positions[path] = f.tell()
        except (IOError, PermissionError):
            pass

    def stop(self):
        self._stop.set()


# ── Windows Event Log reader (pywin32) ───────────────────────────────────────

# Critical Windows Security Event IDs to collect
WIN_SECURITY_IDS = {
    4624: "Logon Success",
    4625: "Logon Failure",
    4634: "Logoff",
    4648: "Explicit Credentials Logon",
    4657: "Registry Value Modified",
    4663: "Object Access",
    4672: "Special Privileges Assigned",
    4688: "Process Created",
    4698: "Scheduled Task Created",
    4702: "Scheduled Task Updated",
    4719: "Audit Policy Changed",
    4720: "User Account Created",
    4722: "User Account Enabled",
    4723: "Password Change Attempt",
    4724: "Password Reset",
    4725: "User Account Disabled",
    4726: "User Account Deleted",
    4728: "Member Added to Global Group",
    4732: "Member Added to Local Group",
    4756: "Member Added to Universal Group",
    4768: "Kerberos TGT Request",
    4769: "Kerberos Service Ticket",
    4771: "Kerberos Pre-auth Failed",
    4776: "NTLM Auth Attempt",
    4778: "Session Reconnect",
    4779: "Session Disconnect",
    7034: "Service Crashed",
    7036: "Service State Changed",
    7045: "New Service Installed",
}

# Logon type mapping (Event 4624/4625)
LOGON_TYPES = {
    2: "Interactive", 3: "Network", 4: "Batch",
    5: "Service",     7: "Unlock",  8: "NetworkCleartext",
    9: "NewCredentials", 10: "RemoteInteractive", 11: "CachedInteractive",
}


class WindowsEventReader(threading.Thread):
    """
    Reads Windows Event Log using pywin32.
    Tracks last-read RecordNumber per channel to avoid duplicates.
    """
    def __init__(self, channels=None):
        super().__init__(daemon=True, name="WinEventReader")
        self.channels = channels or ["Security", "System", "Application"]
        self._stop = threading.Event()
        # channel -> last RecordNumber already sent
        self._last_record: dict[str, int] = {}

    def run(self):
        try:
            import win32evtlog
            import win32evtlogutil
            import pywintypes
        except ImportError:
            logger.warning(
                "pywin32 not installed — install with: pip install pywin32\n"
                "Falling back: use --no-winapi flag to use PowerShell collector instead."
            )
            return

        logger.info("Windows Event Log reader started (channels: %s)", self.channels)

        # Initialise position: start from current newest record
        for channel in self.channels:
            try:
                hand = win32evtlog.OpenEventLog(None, channel)
                newest = win32evtlog.GetNumberOfEventLogRecords(hand)
                oldest = win32evtlog.GetOldestEventLogRecord(hand)
                self._last_record[channel] = oldest + newest - 1
                win32evtlog.CloseEventLog(hand)
            except Exception as e:
                logger.debug("Init position for %s: %s", channel, e)
                self._last_record[channel] = 0

        while not self._stop.is_set():
            for channel in self.channels:
                self._read_channel(channel)
            self._stop.wait(10)

    def _read_channel(self, channel: str):
        try:
            import win32evtlog
            import win32evtlogutil
            import pywintypes

            hand = win32evtlog.OpenEventLog(None, channel)
            total   = win32evtlog.GetNumberOfEventLogRecords(hand)
            oldest  = win32evtlog.GetOldestEventLogRecord(hand)
            newest_rec = oldest + total - 1
            last = self._last_record.get(channel, newest_rec)

            if newest_rec <= last:
                win32evtlog.CloseEventLog(hand)
                return

            # Read forward from last+1
            flags = win32evtlog.EVENTLOG_FORWARDS_READ | win32evtlog.EVENTLOG_SEEK_READ
            events = win32evtlog.ReadEventLog(hand, flags, last + 1)
            win32evtlog.CloseEventLog(hand)

            if not events:
                return

            for ev in events:
                record_num = ev.RecordNumber
                # Actual EventID uses lower 16 bits
                event_id = ev.EventID & 0xFFFF
                name = WIN_SECURITY_IDS.get(event_id, "")

                # Try to get formatted message
                try:
                    msg_str = win32evtlogutil.SafeFormatMessage(ev, channel)
                    msg_str = msg_str.replace("\r\n", " ").replace("\n", " ")[:400]
                except Exception:
                    msg_str = str(ev.StringInserts or "")[:200]

                # Extract key fields from StringInserts
                inserts = ev.StringInserts or []
                username = self._extract_username(inserts, event_id)
                src_ip   = self._extract_src_ip(inserts, event_id)
                logon_t  = self._extract_logon_type(inserts, event_id)

                line = (
                    f"EventID:{event_id}"
                    f" Channel:{channel}"
                    f" Source:{ev.SourceName}"
                    + (f" User:{username}"   if username else "")
                    + (f" SrcIP:{src_ip}"    if src_ip   else "")
                    + (f" LogonType:{logon_t}({LOGON_TYPES.get(logon_t,'?')})" if logon_t else "")
                    + (f" Desc:{name}"       if name     else "")
                    + (f" Msg:{msg_str}"     if msg_str  else "")
                )
                enqueue(line)
                self._last_record[channel] = record_num

        except Exception as e:
            logger.debug("WinEvent read error [%s]: %s", channel, e)

    @staticmethod
    def _extract_username(inserts, event_id):
        # 4624/4625: index 5 = TargetUserName, index 1 = SubjectUserName
        if event_id in (4624, 4625, 4634, 4648, 4720, 4722, 4726) and len(inserts) > 5:
            return inserts[5] or inserts[1] if len(inserts) > 1 else inserts[5]
        return None

    @staticmethod
    def _extract_src_ip(inserts, event_id):
        # 4624/4625: index 18 = IpAddress, 4625: index 19
        if event_id in (4624, 4625) and len(inserts) > 18:
            ip = inserts[18]
            if ip and ip not in ("-", "::1", "127.0.0.1"):
                return ip
        return None

    @staticmethod
    def _extract_logon_type(inserts, event_id):
        if event_id in (4624, 4625) and len(inserts) > 8:
            try:
                return int(inserts[8])
            except (ValueError, TypeError):
                pass
        return None

    def stop(self):
        self._stop.set()


# ── Windows Event Log reader (PowerShell fallback) ────────────────────────────

class PowerShellEventReader(threading.Thread):
    """
    Collects Windows Event Log via PowerShell Get-WinEvent.
    No extra Python packages required — only PowerShell 5+.
    Works on Windows 7+ / Server 2008 R2+.
    """
    PS_CMD = (
        "Get-WinEvent -FilterHashtable @{{LogName='{channel}'; StartTime=(Get-Date).AddSeconds(-{secs})}} "
        "-MaxEvents 200 -ErrorAction SilentlyContinue | "
        "Select-Object TimeCreated,Id,LevelDisplayName,ProviderName,Message | "
        "ConvertTo-Json -Compress"
    )

    def __init__(self, channels=None):
        super().__init__(daemon=True, name="PSEventReader")
        self.channels = channels or ["Security", "System", "Application"]
        self._stop = threading.Event()
        self._seen_ids: set = set()

    def run(self):
        import subprocess
        # Verify PowerShell available
        try:
            subprocess.run(
                ["powershell", "-Command", "echo ok"],
                capture_output=True, timeout=5
            )
        except Exception:
            logger.error("PowerShell not available — Windows Event collection disabled")
            return

        logger.info("PowerShell Event reader started (channels: %s)", self.channels)
        SECS = 60  # look back window on first run, then 30s on subsequent
        first = True

        while not self._stop.is_set():
            look_back = 300 if first else 30
            first = False

            for channel in self.channels:
                self._read_channel_ps(channel, look_back)

            self._stop.wait(20)

    def _read_channel_ps(self, channel: str, secs: int):
        import subprocess
        cmd = self.PS_CMD.format(channel=channel, secs=secs)
        try:
            result = subprocess.run(
                ["powershell", "-NonInteractive", "-NoProfile", "-Command", cmd],
                capture_output=True, text=True, timeout=30
            )
            stdout = result.stdout.strip()
            if not stdout:
                return

            data = json.loads(stdout)
            if isinstance(data, dict):
                data = [data]

            for ev in data:
                ev_id   = ev.get("Id", 0)
                time_c  = ev.get("TimeCreated", "")
                level   = ev.get("LevelDisplayName", "")
                prov    = ev.get("ProviderName", "")
                msg_raw = str(ev.get("Message", ""))[:300].replace("\r\n", " ")

                # Dedup by (channel, time, id)
                uid = f"{channel}:{time_c}:{ev_id}"
                if uid in self._seen_ids:
                    continue
                self._seen_ids.add(uid)
                if len(self._seen_ids) > 50000:
                    self._seen_ids.clear()

                name = WIN_SECURITY_IDS.get(ev_id, "")
                line = (
                    f"EventID:{ev_id}"
                    f" Channel:{channel}"
                    f" Source:{prov}"
                    f" Level:{level}"
                    + (f" Desc:{name}" if name else "")
                    + (f" Msg:{msg_raw}" if msg_raw else "")
                )
                enqueue(line)

        except json.JSONDecodeError:
            pass  # No events returned (empty JSON)
        except Exception as e:
            logger.debug("PS event error [%s]: %s", channel, e)


# ── System metrics collector ──────────────────────────────────────────────────

class MetricsCollector(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True, name="MetricsCollector")
        self._stop = threading.Event()

    def run(self):
        if not HAS_PSUTIL:
            return
        logger.info("System metrics collection enabled")
        while not self._stop.is_set():
            try:
                cpu = psutil.cpu_percent(interval=1)
                mem = psutil.virtual_memory()
                disk = psutil.disk_usage("/")

                if cpu > 90:
                    enqueue(f"URSUS_METRIC: HIGH CPU usage: {cpu}% on {socket.gethostname()}")
                if mem.percent > 90:
                    enqueue(f"URSUS_METRIC: HIGH MEMORY usage: {mem.percent}% on {socket.gethostname()}")
                # Windows root is C:\, Linux is /
                disk_root = "C:\\" if platform.system() == "Windows" else "/"
                disk = psutil.disk_usage(disk_root)
                if disk.percent > 90:
                    enqueue(f"URSUS_METRIC: HIGH DISK usage: {disk.percent}% on {socket.gethostname()}")

                # Check for suspicious processes
                SUSPICIOUS = {"nc", "ncat", "netcat", "mimikatz", "meterpreter",
                              "psexec", "wce", "fgdump", "procdump"}
                for proc in psutil.process_iter(["pid", "name", "username"]):
                    try:
                        pname = (proc.info["name"] or "").lower().replace(".exe", "")
                        if pname in SUSPICIOUS:
                            enqueue(f"URSUS_ALERT: Suspicious process detected: "
                                    f"{proc.info['name']} pid={proc.info['pid']} "
                                    f"user={proc.info['username']} on {socket.gethostname()}")
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        pass

            except Exception as e:
                logger.debug("Metrics error: %s", e)
            self._stop.wait(30)

    def stop(self):
        self._stop.set()


# ── Sender ────────────────────────────────────────────────────────────────────

class EventSender(threading.Thread):
    def __init__(self, server, key, agent_id, interval, source_ip):
        super().__init__(daemon=True, name="EventSender")
        self.server = server.rstrip("/")
        self.key = key
        self.agent_id = agent_id
        self.interval = interval
        self.source_ip = source_ip
        self._stop = threading.Event()
        self._session = requests.Session()
        self._session.headers.update({
            "X-Agent-Key": key,
            "Content-Type": "application/json",
        })
        self._failed_events = []

    def run(self):
        logger.info("Sender started → %s (interval=%ds)", self.server, self.interval)
        while not self._stop.is_set():
            self._stop.wait(self.interval)
            if not self._stop.is_set():
                self._flush()
                self._heartbeat()

    def _flush(self):
        events = []
        # Drain up to 200 events at a time
        while not event_queue.empty() and len(events) < 200:
            try:
                events.append(event_queue.get_nowait())
            except queue.Empty:
                break

        if self._failed_events:
            events = self._failed_events + events
            self._failed_events = []

        if not events:
            return

        payload = {
            "agent_id": self.agent_id,
            "source_ip": self.source_ip,
            "events": events,
        }
        try:
            r = self._session.post(
                f"{self.server}/api/agent/ingest",
                json=payload, timeout=10
            )
            r.raise_for_status()
            data = r.json()
            logger.info("Sent %d events → accepted=%d", len(events), data.get("accepted", 0))
        except Exception as e:
            logger.warning("Send failed: %s — will retry %d events", e, len(events))
            self._failed_events = events[:1000]  # keep at most 1000

    def _heartbeat(self):
        try:
            self._session.post(
                f"{self.server}/api/agent/heartbeat",
                json={"agent_id": self.agent_id},
                timeout=5
            )
        except Exception:
            pass

    def stop(self):
        self._stop.set()


# ── Registration ──────────────────────────────────────────────────────────────

def register(server, key, agent_id):
    hostname = socket.gethostname()
    try:
        ip = socket.gethostbyname(hostname)
    except Exception:
        ip = "unknown"

    os_info = f"{platform.system()} {platform.release()}"
    payload = {
        "agent_id": agent_id,
        "hostname": hostname,
        "ip": ip,
        "os_info": os_info,
        "version": VERSION,
    }
    try:
        r = requests.post(
            f"{server}/api/agent/register",
            json=payload,
            headers={"X-Agent-Key": key},
            timeout=10
        )
        r.raise_for_status()
        logger.info("Registered with SIEM: %s (hostname=%s)", server, hostname)
        return True
    except Exception as e:
        logger.error("Registration failed: %s", e)
        return False


# ── Main ──────────────────────────────────────────────────────────────────────

def _install_windows_service(server: str, key: str):
    """
    Print NSSM / sc.exe commands to register agent as a Windows service.
    Requires NSSM (https://nssm.cc) or Windows Server 2016+ (sc.exe with binPath).
    Must be run as Administrator.
    """
    script = os.path.abspath(__file__)
    py_exe = sys.executable.replace("\\", "\\\\")
    script_esc = script.replace("\\", "\\\\")

    print(f"""
╔══════════════════════════════════════════════════════════╗
║        Ursus Insight Agent — Windows Service Install     ║
╚══════════════════════════════════════════════════════════╝

=== Вариант 1: NSSM (рекомендуется) ===
  # Скачать: https://nssm.cc/download
  nssm install UrsusAgent "{py_exe}" "{script_esc} --server {server} --key {key}"
  nssm set UrsusAgent DisplayName "Ursus Insight Collection Agent"
  nssm set UrsusAgent Description "Ursus Insight SIEM log collection agent"
  nssm set UrsusAgent Start SERVICE_AUTO_START
  nssm set UrsusAgent AppStdout "C:\\ursus\\agent.log"
  nssm set UrsusAgent AppStderr "C:\\ursus\\agent.log"
  nssm start UrsusAgent

=== Вариант 2: Task Scheduler (без NSSM) ===
  schtasks /Create /SC ONSTART /TN "UrsusAgent" /TR "{py_exe} {script_esc} --server {server} --key {key}" /RU SYSTEM /RL HIGHEST /F

=== Управление службой ===
  nssm start UrsusAgent
  nssm stop  UrsusAgent
  nssm status UrsusAgent
  nssm remove UrsusAgent confirm
""")


def main():
    p = argparse.ArgumentParser(description="Ursus Insight Collection Agent")
    p.add_argument("--server",          required=True,  help="SIEM server URL")
    p.add_argument("--key",             required=True,  help="Agent API key")
    p.add_argument("--id",              default=None,   help="Agent ID (default: hostname)")
    p.add_argument("--interval",        type=int, default=10, help="Send interval in seconds")
    p.add_argument("--logs",            default="",     help="Comma-separated log file paths to watch")
    p.add_argument("--channels",        default="Security,System,Application",
                                                        help="Windows Event Log channels (comma-separated)")
    p.add_argument("--no-winapi",       action="store_true",
                                                        help="Use PowerShell instead of pywin32 for Windows events")
    p.add_argument("--install-service", action="store_true",
                                                        help="Print Windows service install commands and exit")
    args = p.parse_args()

    if args.install_service:
        _install_windows_service(args.server, args.key)
        return

    agent_id = args.id or socket.gethostname().replace(" ", "_").replace(" ", "_")
    server   = args.server.rstrip("/")
    channels = [c.strip() for c in args.channels.split(",") if c.strip()]

    try:
        source_ip = socket.gethostbyname(socket.gethostname())
    except Exception:
        source_ip = "127.0.0.1"

    # Determine log paths
    log_paths = []
    if args.logs:
        log_paths = [p.strip() for p in args.logs.split(",") if p.strip()]
    else:
        if platform.system() == "Windows":
            log_paths = [p for p in DEFAULT_LOGS_WINDOWS if os.path.exists(p)]
        else:
            log_paths = [p for p in DEFAULT_LOGS_LINUX if os.path.exists(p)]

    logger.info("Ursus Insight Agent v%s | OS: %s %s", VERSION,
                platform.system(), platform.release())
    logger.info("Agent ID: %s | Server: %s", agent_id, server)
    logger.info("Log paths: %s", log_paths or "none")

    # Register with SIEM
    for attempt in range(5):
        if register(server, args.key, agent_id):
            break
        logger.warning("Retrying registration in 10s... (%d/5)", attempt + 1)
        time.sleep(10)
    else:
        logger.error("Could not register. Continuing in offline mode.")

    # Start threads
    threads = []

    if log_paths:
        tailer = FileTailer(log_paths)
        tailer.start()
        threads.append(tailer)

    if platform.system() == "Windows":
        if args.no_winapi:
            logger.info("Using PowerShell event reader (--no-winapi)")
            win_reader = PowerShellEventReader(channels=channels)
        else:
            logger.info("Using pywin32 event reader (use --no-winapi for PowerShell fallback)")
            win_reader = WindowsEventReader(channels=channels)
        win_reader.start()
        threads.append(win_reader)

    metrics = MetricsCollector()
    metrics.start()
    threads.append(metrics)

    sender = EventSender(server, args.key, agent_id, args.interval, source_ip)
    sender.start()
    threads.append(sender)

    logger.info("Agent running. Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        logger.info("Shutting down agent...")
        for t in threads:
            if hasattr(t, "stop"):
                t.stop()


if __name__ == "__main__":
    main()
