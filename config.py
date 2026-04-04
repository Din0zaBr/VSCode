"""
Ursus Insight SIEM - Configuration
"""
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# --- Web Server ---
WEB_HOST = "0.0.0.0"
WEB_PORT = 8080
SECRET_KEY = os.environ.get("URSUS_SECRET", "ursus-insight-dev-key-change-in-prod")

# --- Syslog Receiver ---
SYSLOG_HOST = "0.0.0.0"
SYSLOG_UDP_PORT = 514
SYSLOG_TCP_PORT = 1514   # non-privileged fallback

# --- Database ---
DB_PATH = os.path.join(BASE_DIR, "data", "ursus.db")

# --- Log directories to monitor ---
LOG_WATCH_PATHS = [
    "/var/log/syslog",
    "/var/log/auth.log",
    "/var/log/kern.log",
    "/var/log/messages",
    "/var/log/secure",
    "/var/log/nginx/access.log",
    "/var/log/nginx/error.log",
    "/var/log/apache2/access.log",
    "/var/log/apache2/error.log",
]

# --- Retention ---
EVENT_RETENTION_DAYS = 30
ALERT_RETENTION_DAYS = 90

# --- Correlation engine ---
CORRELATOR_INTERVAL_SEC = 10

# --- Severity levels ---
SEVERITY_LEVELS = {
    "CRITICAL": 5,
    "HIGH":     4,
    "MEDIUM":   3,
    "LOW":      2,
    "INFO":     1,
}

SEVERITY_COLORS = {
    "CRITICAL": "#FF3131",
    "HIGH":     "#FF6B00",
    "MEDIUM":   "#FFD700",
    "LOW":      "#00BFFF",
    "INFO":     "#A0A0A0",
}

# --- Event categories ---
CATEGORIES = [
    "Authentication",
    "Network",
    "Malware",
    "Policy",
    "System",
    "Application",
    "Intrusion",
    "Privilege",
    "Other",
]

# --- Web Authentication ---
WEB_USERNAME = os.environ.get("URSUS_USER", "admin")
WEB_PASSWORD = os.environ.get("URSUS_PASS", "ursus-change-me")

# --- Agent API ---
AGENT_API_KEY = os.environ.get("URSUS_AGENT_KEY", "agent-dev-key-change-in-prod")
AGENT_PORT = 8081
