"""
URSUS SIEM - Log Parser, Normalizer & Three-Level Event Categorization.
Ported from core/parser.py with extended MaxPatrol SIEM-style categories.
"""
from __future__ import annotations

import re
import time
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger("server.parser")

# ── Syslog RFC 5424 ─────────────────────────────────────────────────────────
_RFC5424 = re.compile(
    r"<(\d+)>(\d)\s+"
    r"(\S+)\s+"           # timestamp
    r"(\S+)\s+"           # hostname
    r"(\S+)\s+"           # app-name
    r"(\S+)\s+"           # procid
    r"(\S+)\s+"           # msgid
    r"(\S+)\s*"           # structured-data
    r"(.*)",              # msg
    re.DOTALL,
)

# ── Syslog BSD RFC 3164 ─────────────────────────────────────────────────────
_RFC3164 = re.compile(
    r"<(\d+)>"
    r"(\w+\s+\d+\s+[\d:]+)\s+"   # timestamp
    r"(\S+)\s+"                   # hostname
    r"([^:]+):\s*"                # program[pid]
    r"(.*)",                      # message
    re.DOTALL,
)

# ── auth.log / /var/log/messages ─────────────────────────────────────────────
_SYSLOG_PLAIN = re.compile(
    r"(\w+\s+\d+\s+[\d:]+)\s+"
    r"(\S+)\s+"
    r"([^\[:]+)(?:\[(\d+)\])?:\s*(.*)",
    re.DOTALL,
)

# ── Nginx/Apache access log ─────────────────────────────────────────────────
_NGINX_ACCESS = re.compile(
    r'(\S+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+'
    r'"(\w+)\s+(\S+)\s+\S+"\s+'
    r'(\d+)\s+(\d+)'
)

# ── Windows Event Log ────────────────────────────────────────────────────────
_WIN_EVENT = re.compile(r"EventID[:\s]+(\d+)", re.IGNORECASE)

# ── CEF ──────────────────────────────────────────────────────────────────────
_CEF = re.compile(
    r"CEF:(\d+)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|(.*)"
)

# ── IP Address extraction ───────────────────────────────────────────────────
_IP_RE = re.compile(r"\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b")

# ── Severity keywords ───────────────────────────────────────────────────────
_SEV_MAP = {
    "emerg":    "CRITICAL", "panic":     "CRITICAL",
    "alert":    "CRITICAL", "crit":      "CRITICAL",
    "error":    "ERROR",    "err":       "ERROR",
    "warn":     "WARNING",  "warning":   "WARNING",
    "notice":   "INFO",     "info":      "INFO",
    "debug":    "INFO",
    "failed":   "ERROR",    "failure":   "ERROR",
    "denied":   "ERROR",    "invalid":   "WARNING",
    "accepted": "INFO",     "success":   "INFO",
}

# ── Three-level event categories (MaxPatrol SIEM style) ─────────────────────
EVENT_CATEGORIES: dict[str, dict[str, list[str]]] = {
    "Access": {
        "Authentication": [
            "Default Credentials", "Host", "Local", "Remote",
            "Service", "Unknown Type",
        ],
        "Authorization": ["Host", "Network", "Object", "User"],
        "Accounting": [
            "Network Accounting", "Address Translation",
            "Connections & Sessions", "Session Accounting",
        ],
    },
    "Attacks & Recon": {
        "Attack": [
            "Bruteforce", "Complex Attack", "DDoS", "DoS",
            "HIPS Alert", "IDS Alert", "Malicious URL",
            "Spam", "SQL Injection", "Web Attack", "XSS",
        ],
        "Recon": [
            "Crawling/Dictionary Bruteforce", "Enumeration",
            "Fingerprinting", "Host Discovery", "Port Scanning",
            "Vulnerability Scanning",
        ],
    },
    "Malware": {
        "Backdoor": ["Curing", "Detection", "Epidemic", "Mitigation"],
        "Bootkit": [],
        "Botnet": [],
        "Rootkit": [],
        "Trojan": [],
        "Virus": [],
        "Worm": [],
        "Adware": [],
        "Ransomware": [],
    },
    "Network": {
        "Connection": ["Established", "Closed", "Denied", "Timeout"],
        "Firewall": ["Allow", "Block", "Drop", "Reject"],
        "DNS": ["Query", "Response", "Block"],
        "DHCP": ["Lease", "Release", "Renew"],
        "VPN": ["Connect", "Disconnect", "Failure"],
    },
    "System": {
        "Configuration": ["Change", "Error", "Policy Change"],
        "Service": ["Start", "Stop", "Crash", "Restart"],
        "Process": ["Create", "Terminate", "Injection"],
        "File": ["Create", "Modify", "Delete", "Access"],
        "User Management": ["Create", "Delete", "Modify", "Lock", "Unlock"],
        "Privilege": ["Escalation", "Delegation", "Sudo"],
    },
    "Application": {
        "HTTP": ["Request", "Error 4xx", "Error 5xx"],
        "Database": ["Query", "Error", "Slow Query"],
        "Email": ["Send", "Receive", "Blocked"],
        "Web": ["Access", "Error", "Upload", "Download"],
    },
    "Compliance": {
        "Audit": ["Login", "Logout", "Access", "Change"],
        "Policy": ["Violation", "Enforcement", "Update"],
    },
}

# ── Category detection patterns ──────────────────────────────────────────────
_CATEGORY_PATTERNS: list[tuple[re.Pattern, str, str, str]] = [
    # (regex, generic, high, low)
    # Access / Authentication
    (re.compile(r"Failed password|authentication failure|Login incorrect|invalid password", re.I),
     "Access", "Authentication", "Remote"),
    (re.compile(r"Accepted (password|publickey)|Successful login", re.I),
     "Access", "Authentication", "Remote"),
    (re.compile(r"default.*password|default.*credentials", re.I),
     "Access", "Authentication", "Default Credentials"),
    (re.compile(r"ssh|sshd|pam_unix.*session|kerberos|ldap.*bind", re.I),
     "Access", "Authentication", "Remote"),
    (re.compile(r"login|logon|logoff|logout|session opened|session closed", re.I),
     "Access", "Authentication", "Local"),
    # Access / Authorization
    (re.compile(r"permission denied|access denied|forbidden|unauthorized", re.I),
     "Access", "Authorization", "Object"),
    (re.compile(r"EventID.*4672|special privileges|SeDebugPrivilege", re.I),
     "Access", "Authorization", "User"),
    # Attacks / Attack
    (re.compile(r"brute.?force|too many.*attempts|rate.?limit", re.I),
     "Attacks & Recon", "Attack", "Bruteforce"),
    (re.compile(r"ddos|distributed.*denial", re.I),
     "Attacks & Recon", "Attack", "DDoS"),
    (re.compile(r"dos|denial.*service", re.I),
     "Attacks & Recon", "Attack", "DoS"),
    (re.compile(r"sql.*inject|sqli|union.*select", re.I),
     "Attacks & Recon", "Attack", "SQL Injection"),
    (re.compile(r"xss|cross.?site.?script", re.I),
     "Attacks & Recon", "Attack", "XSS"),
    (re.compile(r"web.*attack|exploit.*http|rce|remote.*code.*exec", re.I),
     "Attacks & Recon", "Attack", "Web Attack"),
    (re.compile(r"snort|suricata|ids.*alert|ips.*alert|intrusion", re.I),
     "Attacks & Recon", "Attack", "IDS Alert"),
    # Attacks / Recon
    (re.compile(r"port.?scan|nmap|masscan", re.I),
     "Attacks & Recon", "Recon", "Port Scanning"),
    (re.compile(r"enumerat|directory.*brute|crawl|nikto|dirbust", re.I),
     "Attacks & Recon", "Recon", "Enumeration"),
    (re.compile(r"fingerprint|banner.*grab", re.I),
     "Attacks & Recon", "Recon", "Fingerprinting"),
    (re.compile(r"vuln.*scan|openvas|nessus|qualys", re.I),
     "Attacks & Recon", "Recon", "Vulnerability Scanning"),
    (re.compile(r"host.*discover|ping.*sweep|arp.*scan", re.I),
     "Attacks & Recon", "Recon", "Host Discovery"),
    # Malware
    (re.compile(r"malware|infected|quarantin", re.I),
     "Malware", "Virus", ""),
    (re.compile(r"trojan|rat\b|remote.*access.*tool", re.I),
     "Malware", "Trojan", ""),
    (re.compile(r"virus|antivirus.*detect", re.I),
     "Malware", "Virus", ""),
    (re.compile(r"worm|propagat", re.I),
     "Malware", "Worm", ""),
    (re.compile(r"rootkit", re.I),
     "Malware", "Rootkit", ""),
    (re.compile(r"ransomware|encrypt.*files|bitcoin.*ransom", re.I),
     "Malware", "Ransomware", ""),
    (re.compile(r"backdoor|reverse.*shell|bind.*shell|c2.*beacon", re.I),
     "Malware", "Backdoor", "Detection"),
    (re.compile(r"botnet|zombie|command.*control|c&c", re.I),
     "Malware", "Botnet", ""),
    # Network / Firewall
    (re.compile(r"iptables.*DROP|UFW BLOCK|firewall.*block|netfilter.*DROP", re.I),
     "Network", "Firewall", "Drop"),
    (re.compile(r"iptables.*ACCEPT|firewall.*allow", re.I),
     "Network", "Firewall", "Allow"),
    (re.compile(r"iptables.*REJECT|firewall.*reject", re.I),
     "Network", "Firewall", "Reject"),
    # Network / Connection
    (re.compile(r"connection.*established|connected to", re.I),
     "Network", "Connection", "Established"),
    (re.compile(r"connection.*closed|disconnect", re.I),
     "Network", "Connection", "Closed"),
    (re.compile(r"connection.*denied|connection.*refused", re.I),
     "Network", "Connection", "Denied"),
    (re.compile(r"connection.*timeout|timed out", re.I),
     "Network", "Connection", "Timeout"),
    # Network / VPN
    (re.compile(r"vpn.*connect|tunnel.*establish", re.I),
     "Network", "VPN", "Connect"),
    (re.compile(r"vpn.*disconnect|tunnel.*close", re.I),
     "Network", "VPN", "Disconnect"),
    # System / User Management
    (re.compile(r"useradd|new user|EventID.*4720|account.*created", re.I),
     "System", "User Management", "Create"),
    (re.compile(r"userdel|deleted user|EventID.*4726|account.*deleted", re.I),
     "System", "User Management", "Delete"),
    (re.compile(r"passwd|password.*changed|EventID.*4723|EventID.*4724", re.I),
     "System", "User Management", "Modify"),
    (re.compile(r"account.*locked|EventID.*4740", re.I),
     "System", "User Management", "Lock"),
    # System / Privilege
    (re.compile(r"sudo.*COMMAND|su\b.*root|privilege.*escalat|setuid", re.I),
     "System", "Privilege", "Escalation"),
    # System / Service
    (re.compile(r"service.*start|systemd.*Started|daemon.*start", re.I),
     "System", "Service", "Start"),
    (re.compile(r"service.*stop|systemd.*Stopped|daemon.*stop", re.I),
     "System", "Service", "Stop"),
    (re.compile(r"segfault|core dumped|service.*crash", re.I),
     "System", "Service", "Crash"),
    # System / Configuration
    (re.compile(r"config.*chang|policy.*chang|EventID.*4719", re.I),
     "System", "Configuration", "Policy Change"),
    # Application / HTTP
    (re.compile(r"nginx|apache|http|GET\s+/|POST\s+/|PUT\s+/|DELETE\s+/", re.I),
     "Application", "HTTP", "Request"),
    # Compliance / Audit
    (re.compile(r"audit|compliance|policy.*violat", re.I),
     "Compliance", "Audit", "Access"),
]

# ── Event type patterns ──────────────────────────────────────────────────────
_TYPE_PATTERNS = [
    (re.compile(r"Failed password|authentication failure|Login incorrect", re.I), "auth_failure"),
    (re.compile(r"Accepted (password|publickey)", re.I), "auth_success"),
    (re.compile(r"sudo.*COMMAND|sudo.*allowed", re.I), "sudo_exec"),
    (re.compile(r"new user:|useradd", re.I), "user_created"),
    (re.compile(r"userdel|deleted user", re.I), "user_deleted"),
    (re.compile(r"IPTABLES.*DROP|firewall.*block|UFW BLOCK", re.I), "fw_drop"),
    (re.compile(r"EventID.*4625|Logon Failure", re.I), "rdp_failure"),
    (re.compile(r"EventID.*4624|Logon Success", re.I), "rdp_success"),
    (re.compile(r"EventID.*4720", re.I), "win_user_created"),
    (re.compile(r"EventID.*4672", re.I), "win_priv_logon"),
    (re.compile(r"port.?scan|nmap", re.I), "port_scan"),
    (re.compile(r"malware|virus|trojan", re.I), "malware_detected"),
    (re.compile(r"brute.?force", re.I), "bruteforce"),
]


def parse_syslog_priority(pri_val: str | int) -> str:
    pri = int(pri_val)
    severity_code = pri & 0x7
    sev_names = ["CRITICAL", "CRITICAL", "CRITICAL", "ERROR", "WARNING", "INFO", "INFO", "INFO"]
    return sev_names[min(severity_code, 7)]


def detect_severity(message: str, default: str | None = "INFO") -> str | None:
    msg_lower = message.lower()
    for kw, sev in _SEV_MAP.items():
        if kw in msg_lower:
            return sev
    return default


def detect_event_type(message: str) -> str:
    for pattern, evt_type in _TYPE_PATTERNS:
        if pattern.search(message):
            return evt_type
    return "generic"


def detect_category(message: str) -> dict[str, str]:
    """Detect three-level event category from message text."""
    for pattern, generic, high, low in _CATEGORY_PATTERNS:
        if pattern.search(message):
            return {"generic": generic, "high": high, "low": low}
    return {"generic": "Other", "high": "", "low": ""}


def extract_ips(message: str) -> list[str]:
    return _IP_RE.findall(message)


def _try_parse_ts(ts_str: str) -> float | None:
    formats = [
        "%b %d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S%z",
        "%d/%b/%Y:%H:%M:%S %z",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(ts_str.strip(), fmt)
            if dt.year == 1900:
                dt = dt.replace(year=datetime.now().year)
            return dt.timestamp()
        except ValueError:
            continue
    return None


def parse_log_line(raw: str, source_ip: str | None = None) -> dict[str, Any] | None:
    """Universal parser. Returns a normalized dict with enrichment data."""
    raw = raw.strip()
    if not raw:
        return None

    result: dict[str, Any] = {
        "raw_message": raw,
        "timestamp": time.time(),
        "source_ip": source_ip,
        "source_host": None,
        "severity": "INFO",
        "event_type": "generic",
        "category": {"generic": "Other", "high": "", "low": ""},
        "parsed": {},
    }

    # Try CEF
    m = _CEF.match(raw)
    if m:
        severity_num = int(m.group(7)) if m.group(7).isdigit() else 5
        sev = "CRITICAL" if severity_num >= 9 else \
              "ERROR"    if severity_num >= 7 else \
              "WARNING"  if severity_num >= 4 else "INFO"
        result.update({
            "severity": sev,
            "event_type": m.group(5),
            "category": detect_category(raw),
            "parsed": {
                "cef_version": m.group(1),
                "vendor": m.group(2),
                "product": m.group(3),
                "signature": m.group(5),
                "name": m.group(6),
                "extensions": m.group(8),
            },
        })
        return result

    # Try RFC 5424
    m = _RFC5424.match(raw)
    if m:
        pri, _, ts, host, app, _, _, _, msg = m.groups()
        pri_sev = parse_syslog_priority(pri)
        content_sev = detect_severity(msg, default=None)
        result.update({
            "source_host": host if host != "-" else None,
            "severity": content_sev if content_sev else pri_sev,
            "event_type": detect_event_type(msg),
            "category": detect_category(msg),
            "parsed": {"app": app, "msg": msg},
        })
        parsed_ts = _try_parse_ts(ts)
        if parsed_ts:
            result["timestamp"] = parsed_ts
        return result

    # Try RFC 3164
    m = _RFC3164.match(raw)
    if m:
        pri, ts, host, prog, msg = m.groups()
        pri_sev = parse_syslog_priority(pri)
        content_sev = detect_severity(msg, default=None)
        result.update({
            "source_host": host,
            "severity": content_sev if content_sev else pri_sev,
            "event_type": detect_event_type(msg),
            "category": detect_category(msg),
            "parsed": {"program": prog.strip(), "msg": msg},
        })
        parsed_ts = _try_parse_ts(ts)
        if parsed_ts:
            result["timestamp"] = parsed_ts
        return result

    # Try plain syslog
    m = _SYSLOG_PLAIN.match(raw)
    if m:
        ts, host, prog, pid, msg = m.groups()
        result.update({
            "source_host": host,
            "severity": detect_severity(msg) or "INFO",
            "event_type": detect_event_type(msg),
            "category": detect_category(msg),
            "parsed": {"program": prog.strip(), "pid": pid, "msg": msg},
        })
        parsed_ts = _try_parse_ts(ts)
        if parsed_ts:
            result["timestamp"] = parsed_ts
        return result

    # Try nginx/apache access log
    m = _NGINX_ACCESS.match(raw)
    if m:
        ip, _user, _ts, method, path, status_code, size = m.groups()
        sc = int(status_code)
        sev = "ERROR" if sc >= 500 else "WARNING" if sc >= 400 else "INFO"
        result.update({
            "source_ip": source_ip or ip,
            "severity": sev,
            "event_type": "http_request",
            "category": {"generic": "Application", "high": "HTTP", "low": f"Error {sc // 100}xx" if sc >= 400 else "Request"},
            "parsed": {
                "client_ip": ip, "method": method,
                "path": path, "status": sc, "size": size,
            },
        })
        return result

    # Fallback
    ips = extract_ips(raw)
    if ips and not result["source_ip"]:
        result["source_ip"] = ips[0]

    result.update({
        "severity": detect_severity(raw) or "INFO",
        "event_type": detect_event_type(raw),
        "category": detect_category(raw),
    })
    return result


def parse_and_enrich(message: str, existing_meta: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Parse a log message and return enrichment data to merge into event meta.
    This is the main entry point used by IngestPipeline.
    """
    parsed = parse_log_line(message)
    if not parsed:
        return {}

    enrichment: dict[str, Any] = {
        "category": parsed["category"],
        "event_type": parsed["event_type"],
    }

    source_ips = extract_ips(message)
    if source_ips:
        enrichment["source_ips"] = source_ips
        if not (existing_meta or {}).get("src_ip"):
            enrichment["src_ip"] = source_ips[0]

    if parsed.get("source_host"):
        enrichment["src_host"] = parsed["source_host"]

    if parsed["severity"] != "INFO":
        enrichment["detected_level"] = parsed["severity"]

    if parsed.get("parsed"):
        enrichment["parsed"] = parsed["parsed"]

    return enrichment
