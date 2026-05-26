"""
Ursus Insight SIEM - Log Parser & Normalizer
Supports: RFC 5424 syslog, auth.log, nginx, CEF, plain text
"""
import re
import time
import logging
from datetime import datetime

logger = logging.getLogger("ursus.parser")

# ── Syslog RFC 5424 ──────────────────────────────────────────────────────────
_RFC5424 = re.compile(
    r"<(\d+)>(\d)\s+"
    r"(\S+)\s+"           # timestamp
    r"(\S+)\s+"           # hostname
    r"(\S+)\s+"           # app-name
    r"(\S+)\s+"           # procid
    r"(\S+)\s+"           # msgid
    r"(\S+)\s*"           # structured-data
    r"(.*)",              # msg
    re.DOTALL
)

# ── Syslog BSD RFC 3164 ───────────────────────────────────────────────────────
_RFC3164 = re.compile(
    r"<(\d+)>"
    r"(\w+\s+\d+\s+[\d:]+)\s+"   # timestamp
    r"(\S+)\s+"                   # hostname
    r"([^:]+):\s*"                # program[pid]
    r"(.*)",                      # message
    re.DOTALL
)

# ── auth.log / /var/log/messages ─────────────────────────────────────────────
_SYSLOG_PLAIN = re.compile(
    r"(\w+\s+\d+\s+[\d:]+)\s+"
    r"(\S+)\s+"
    r"([^\[:]+)(?:\[(\d+)\])?:\s*(.*)",
    re.DOTALL
)

# ── Nginx/Apache access log ───────────────────────────────────────────────────
_NGINX_ACCESS = re.compile(
    r'(\S+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+'
    r'"(\w+)\s+(\S+)\s+\S+"\s+'
    r'(\d+)\s+(\d+)'
)

# ── Windows Event Log (forwarded as text) ────────────────────────────────────
_WIN_EVENT = re.compile(r"EventID[:\s]+(\d+)", re.IGNORECASE)
_WIN_ACCOUNT = re.compile(r"Account Name[:\s]+(\S+)", re.IGNORECASE)
_WIN_LOGON_TYPE = re.compile(r"Logon Type[:\s]+(\d+)", re.IGNORECASE)

# ── CEF ───────────────────────────────────────────────────────────────────────
_CEF = re.compile(
    r"CEF:(\d+)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|(.*)"
)

# ── IP Address extraction ────────────────────────────────────────────────────
_IP_RE = re.compile(r"\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b")
_HOST_RE = re.compile(r"(?:from|src|source)[=:\s]+(\S+)", re.IGNORECASE)

# ── Severity keywords ─────────────────────────────────────────────────────────
_SEV_MAP = {
    "emerg":   "CRITICAL", "panic":    "CRITICAL",
    "alert":   "CRITICAL", "crit":     "CRITICAL",
    "error":   "HIGH",     "err":      "HIGH",
    "warn":    "MEDIUM",   "warning":  "MEDIUM",
    "notice":  "LOW",      "info":     "INFO",
    "debug":   "INFO",
    # security keywords
    "failed":  "HIGH",     "failure":  "HIGH",
    "denied":  "HIGH",     "invalid":  "MEDIUM",
    "accepted":"INFO",     "success":  "INFO",
}

# ── Category patterns ─────────────────────────────────────────────────────────
_CAT_PATTERNS = [
    (re.compile(r"ssh|login|logout|password|authentication|pam|kerberos", re.I), "Authentication"),
    (re.compile(r"iptables|firewall|netfilter|DROP|ACCEPT|REJECT|port\s*scan", re.I), "Network"),
    (re.compile(r"malware|virus|trojan|ransomware|rootkit|exploit|payload", re.I), "Malware"),
    (re.compile(r"sudo|su\b|privilege|escalat|wheel|setuid|EventID:4672", re.I), "Privilege"),
    (re.compile(r"useradd|userdel|passwd|groupadd|account|EventID:4720|EventID:4726", re.I), "System"),
    (re.compile(r"nginx|apache|http|GET|POST|PUT|DELETE|url|request", re.I), "Application"),
    (re.compile(r"snort|suricata|ids|ips|intrusion|attack|scan", re.I), "Intrusion"),
    (re.compile(r"policy|compliance|audit|EventID:4719", re.I), "Policy"),
]

# ── Event type patterns ───────────────────────────────────────────────────────
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
]


def parse_syslog_priority(pri_val):
    pri = int(pri_val)
    facility = pri >> 3
    severity_code = pri & 0x7
    sev_names = ["CRITICAL","CRITICAL","CRITICAL","HIGH","MEDIUM","LOW","LOW","INFO"]
    return sev_names[min(severity_code, 7)]


def detect_category(message: str) -> str:
    for pattern, cat in _CAT_PATTERNS:
        if pattern.search(message):
            return cat
    return "Other"


def detect_severity(message: str, default="INFO") -> str:
    msg_lower = message.lower()
    for kw, sev in _SEV_MAP.items():
        if kw in msg_lower:
            return sev
    return default  # type: ignore


def detect_event_type(message: str) -> str:
    for pattern, evt_type in _TYPE_PATTERNS:
        if pattern.search(message):
            return evt_type
    return "generic"


def extract_ips(message: str):
    return _IP_RE.findall(message)


def parse_log_line(raw: str, source_ip: str = None):
    """
    Universal parser. Returns a normalized dict:
    {
      timestamp, source_ip, source_host,
      category, severity, event_type,
      raw_message, parsed
    }
    """
    raw = raw.strip()
    if not raw:
        return None

    result = {
        "raw_message": raw,
        "timestamp": time.time(),
        "source_ip": source_ip,
        "source_host": None,
        "category": "Other",
        "severity": "INFO",
        "event_type": "generic",
        "parsed": {},
    }

    # Try CEF first
    m = _CEF.match(raw)
    if m:
        severity_num = int(m.group(7)) if m.group(7).isdigit() else 5
        sev = "CRITICAL" if severity_num >= 9 else \
              "HIGH"     if severity_num >= 7 else \
              "MEDIUM"   if severity_num >= 4 else "LOW"
        result.update({
            "severity": sev,
            "event_type": m.group(5),
            "parsed": {
                "cef_version": m.group(1),
                "vendor": m.group(2),
                "product": m.group(3),
                "signature": m.group(5),
                "name": m.group(6),
                "extensions": m.group(8),
            }
        })
        result["category"] = detect_category(raw)
        return result

    # Try RFC 5424
    m = _RFC5424.match(raw)
    if m:
        pri, _, ts, host, app, _, _, _, msg = m.groups()
        pri_sev = parse_syslog_priority(pri)
        # Content-based detection overrides syslog priority for security events
        content_sev = detect_severity(msg, default=None)
        sev = content_sev if content_sev else pri_sev
        result.update({
            "source_host": host if host != "-" else None,
            "severity": sev,
            "event_type": detect_event_type(msg),
            "category": detect_category(msg),
            "parsed": {"app": app, "msg": msg},
        })
        _try_parse_ts(ts, result)
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
        _try_parse_ts(ts, result)
        return result

    # Try plain syslog
    m = _SYSLOG_PLAIN.match(raw)
    if m:
        ts, host, prog, pid, msg = m.groups()
        result.update({
            "source_host": host,
            "severity": detect_severity(msg),
            "event_type": detect_event_type(msg),
            "category": detect_category(msg),
            "parsed": {"program": prog.strip(), "pid": pid, "msg": msg},
        })
        _try_parse_ts(ts, result)
        return result

    # Try nginx/apache access log
    m = _NGINX_ACCESS.match(raw)
    if m:
        ip, user, ts, method, path, status_code, size = m.groups()
        sc = int(status_code)
        sev = "HIGH" if sc >= 500 else "MEDIUM" if sc >= 400 else "INFO"
        result.update({
            "source_ip": source_ip or ip,
            "severity": sev,
            "event_type": "http_request",
            "category": "Application",
            "parsed": {
                "client_ip": ip, "method": method,
                "path": path, "status": sc, "size": size
            },
        })
        return result

    # Fallback: detect everything from raw text
    ips = extract_ips(raw)
    if ips and not result["source_ip"]:
        result["source_ip"] = ips[0]

    result.update({
        "severity": detect_severity(raw),
        "event_type": detect_event_type(raw),
        "category": detect_category(raw),
    })
    return result


def _try_parse_ts(ts_str: str, result: dict):
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
            # If no year in format, use current year
            if dt.year == 1900:
                dt = dt.replace(year=datetime.now().year)
            result["timestamp"] = dt.timestamp()
            return
        except ValueError:
            continue
