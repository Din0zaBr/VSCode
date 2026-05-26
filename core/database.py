"""
Ursus Insight SIEM - Database Layer (SQLite)
"""
import sqlite3
import threading
import time
import json
import logging
from datetime import datetime, timedelta
from contextlib import contextmanager

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import config

logger = logging.getLogger("ursus.db")

_lock = threading.Lock()


@contextmanager
def get_conn():
    conn = sqlite3.connect(config.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    os.makedirs(os.path.dirname(config.DB_PATH), exist_ok=True)
    with get_conn() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   REAL    NOT NULL,
            received_at REAL    NOT NULL DEFAULT (unixepoch('now','subsec')),
            source_ip   TEXT,
            source_host TEXT,
            category    TEXT    DEFAULT 'Other',
            severity    TEXT    DEFAULT 'INFO',
            event_type  TEXT,
            raw_message TEXT    NOT NULL,
            parsed      TEXT,
            tags        TEXT    DEFAULT '[]',
            agent_id    TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_events_ts   ON events(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_events_sev  ON events(severity);
        CREATE INDEX IF NOT EXISTS idx_events_cat  ON events(category);
        CREATE INDEX IF NOT EXISTS idx_events_src  ON events(source_ip);

        CREATE TABLE IF NOT EXISTS alerts (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at   REAL    NOT NULL DEFAULT (unixepoch('now','subsec')),
            updated_at   REAL    NOT NULL DEFAULT (unixepoch('now','subsec')),
            rule_id      TEXT    NOT NULL,
            rule_name    TEXT    NOT NULL,
            severity     TEXT    NOT NULL,
            status       TEXT    NOT NULL DEFAULT 'OPEN',
            source_ip    TEXT,
            description  TEXT,
            event_ids    TEXT    DEFAULT '[]',
            notes        TEXT    DEFAULT ''
        );

        CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_alerts_status  ON alerts(status);
        CREATE INDEX IF NOT EXISTS idx_alerts_rule    ON alerts(rule_id);

        CREATE TABLE IF NOT EXISTS rules (
            id          TEXT    PRIMARY KEY,
            name        TEXT    NOT NULL,
            description TEXT,
            severity    TEXT    NOT NULL DEFAULT 'MEDIUM',
            enabled     INTEGER NOT NULL DEFAULT 1,
            conditions  TEXT    NOT NULL,
            created_at  REAL    NOT NULL DEFAULT (unixepoch('now','subsec')),
            updated_at  REAL    NOT NULL DEFAULT (unixepoch('now','subsec')),
            hit_count   INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS agents (
            id           TEXT    PRIMARY KEY,
            hostname     TEXT    NOT NULL,
            ip           TEXT,
            os_info      TEXT,
            version      TEXT,
            last_seen    REAL,
            status       TEXT    NOT NULL DEFAULT 'UNKNOWN',
            events_sent  INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS stats_hourly (
            hour        INTEGER PRIMARY KEY,
            total       INTEGER NOT NULL DEFAULT 0,
            critical    INTEGER NOT NULL DEFAULT 0,
            high        INTEGER NOT NULL DEFAULT 0,
            medium      INTEGER NOT NULL DEFAULT 0,
            low         INTEGER NOT NULL DEFAULT 0,
            info        INTEGER NOT NULL DEFAULT 0
        );
        """)
    logger.info("Database initialized at %s", config.DB_PATH)
    _seed_default_rules()


# ── Events ─────────────────────────────────────────────────────────────────

def insert_event(source_ip, source_host, category, severity,
                 event_type, raw_message, parsed=None,
                 timestamp=None, tags=None, agent_id=None):
    ts = timestamp or time.time()
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO events
               (timestamp, source_ip, source_host, category, severity,
                event_type, raw_message, parsed, tags, agent_id)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (ts, source_ip, source_host, category, severity,
             event_type, raw_message,
             json.dumps(parsed) if parsed else None,
             json.dumps(tags or []),
             agent_id)
        )
        event_id = cur.lastrowid
    _update_hourly_stats(ts, severity)
    return event_id


def get_events(limit=200, offset=0, severity=None, category=None,
               source_ip=None, search=None, since=None, until=None):
    clauses, params = [], []
    if severity:
        clauses.append("severity = ?"); params.append(severity)
    if category:
        clauses.append("category = ?"); params.append(category)
    if source_ip:
        clauses.append("source_ip = ?"); params.append(source_ip)
    if search:
        clauses.append("raw_message LIKE ?"); params.append(f"%{search}%")
    if since:
        clauses.append("timestamp >= ?"); params.append(since)
    if until:
        clauses.append("timestamp <= ?"); params.append(until)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    params += [limit, offset]
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM events {where} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            params
        ).fetchall()
    return [dict(r) for r in rows]


def count_events(**filters):
    clauses, params = [], []
    if filters.get("since"):
        clauses.append("timestamp >= ?"); params.append(filters["since"])
    if filters.get("severity"):
        clauses.append("severity = ?"); params.append(filters["severity"])
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    with get_conn() as conn:
        return conn.execute(f"SELECT COUNT(*) FROM events {where}", params).fetchone()[0]


def get_top_sources(limit=10, since=None):
    params = []
    where = ""
    if since:
        where = "WHERE timestamp >= ?"
        params.append(since)
    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT source_ip, source_host, COUNT(*) as cnt
                FROM events {where}
                GROUP BY source_ip
                ORDER BY cnt DESC LIMIT ?""",
            params + [limit]
        ).fetchall()
    return [dict(r) for r in rows]


def get_events_by_hour(hours=24):
    since = time.time() - hours * 3600
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT strftime('%Y-%m-%dT%H:00:00', datetime(timestamp,'unixepoch')) as hour,
                      severity, COUNT(*) as cnt
               FROM events
               WHERE timestamp >= ?
               GROUP BY hour, severity
               ORDER BY hour""",
            (since,)
        ).fetchall()
    return [dict(r) for r in rows]


def get_category_distribution(since=None):
    params = []
    where = ""
    if since:
        where = "WHERE timestamp >= ?"
        params.append(since)
    with get_conn() as conn:
        rows = conn.execute(
            f"""SELECT category, COUNT(*) as cnt
                FROM events {where}
                GROUP BY category ORDER BY cnt DESC""",
            params
        ).fetchall()
    return [dict(r) for r in rows]


# ── Alerts ─────────────────────────────────────────────────────────────────

def insert_alert(rule_id, rule_name, severity, source_ip, description, event_ids):
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO alerts
               (rule_id, rule_name, severity, source_ip, description, event_ids)
               VALUES (?,?,?,?,?,?)""",
            (rule_id, rule_name, severity, source_ip, description,
             json.dumps(event_ids))
        )
        return cur.lastrowid


def get_alerts(limit=100, offset=0, status=None, severity=None, since=None):
    clauses, params = [], []
    if status:
        clauses.append("status = ?"); params.append(status)
    if severity:
        clauses.append("severity = ?"); params.append(severity)
    if since:
        clauses.append("created_at >= ?"); params.append(since)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    params += [limit, offset]
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM alerts {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            params
        ).fetchall()
    return [dict(r) for r in rows]


def update_alert_status(alert_id, status, notes=None):
    with get_conn() as conn:
        if notes is not None:
            conn.execute(
                "UPDATE alerts SET status=?, notes=?, updated_at=? WHERE id=?",
                (status, notes, time.time(), alert_id)
            )
        else:
            conn.execute(
                "UPDATE alerts SET status=?, updated_at=? WHERE id=?",
                (status, time.time(), alert_id)
            )


def count_alerts(status=None, since=None):
    clauses, params = [], []
    if status:
        clauses.append("status = ?"); params.append(status)
    if since:
        clauses.append("created_at >= ?"); params.append(since)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    with get_conn() as conn:
        return conn.execute(f"SELECT COUNT(*) FROM alerts {where}", params).fetchone()[0]


# ── Rules ──────────────────────────────────────────────────────────────────

def get_rules(enabled_only=False):
    with get_conn() as conn:
        q = "SELECT * FROM rules"
        if enabled_only:
            q += " WHERE enabled=1"
        rows = conn.execute(q + " ORDER BY name").fetchall()
    return [dict(r) for r in rows]


def upsert_rule(rule):
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO rules (id,name,description,severity,enabled,conditions,updated_at)
               VALUES (:id,:name,:description,:severity,:enabled,:conditions,unixepoch('now','subsec'))
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, description=excluded.description,
                 severity=excluded.severity, enabled=excluded.enabled,
                 conditions=excluded.conditions,
                 updated_at=excluded.updated_at""",
            rule
        )


def increment_rule_hits(rule_id):
    with get_conn() as conn:
        conn.execute(
            "UPDATE rules SET hit_count = hit_count + 1 WHERE id = ?", (rule_id,)
        )


# ── Agents ─────────────────────────────────────────────────────────────────

def upsert_agent(agent_id, hostname, ip, os_info, version):
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO agents (id, hostname, ip, os_info, version, last_seen, status)
               VALUES (?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 hostname=excluded.hostname, ip=excluded.ip,
                 os_info=excluded.os_info, version=excluded.version,
                 last_seen=excluded.last_seen, status='ONLINE'""",
            (agent_id, hostname, ip, os_info, version, time.time(), "ONLINE")
        )


def get_agents():
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM agents ORDER BY last_seen DESC").fetchall()
    return [dict(r) for r in rows]


def mark_stale_agents(timeout_sec=120):
    cutoff = time.time() - timeout_sec
    with get_conn() as conn:
        conn.execute(
            "UPDATE agents SET status='OFFLINE' WHERE last_seen < ? AND status='ONLINE'",
            (cutoff,)
        )


# ── Stats ──────────────────────────────────────────────────────────────────

def _update_hourly_stats(ts, severity):
    hour = int(ts // 3600) * 3600
    sev = severity.upper()
    col = sev.lower() if sev in ("CRITICAL","HIGH","MEDIUM","LOW","INFO") else "info"
    with get_conn() as conn:
        conn.execute(
            f"""INSERT INTO stats_hourly (hour, total, {col})
                VALUES (?,1,1)
                ON CONFLICT(hour) DO UPDATE SET
                  total=total+1, {col}={col}+1""",
            (hour,)
        )


def get_dashboard_stats():
    now = time.time()
    day_ago = now - 86400
    with get_conn() as conn:
        total_events  = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        events_24h    = conn.execute("SELECT COUNT(*) FROM events WHERE timestamp>=?", (day_ago,)).fetchone()[0]
        open_alerts   = conn.execute("SELECT COUNT(*) FROM alerts WHERE status='OPEN'").fetchone()[0]
        critical_24h  = conn.execute(
            "SELECT COUNT(*) FROM events WHERE timestamp>=? AND severity='CRITICAL'", (day_ago,)
        ).fetchone()[0]
        agents_online = conn.execute("SELECT COUNT(*) FROM agents WHERE status='ONLINE'").fetchone()[0]
        by_sev = conn.execute(
            """SELECT severity, COUNT(*) as cnt FROM events
               WHERE timestamp>=? GROUP BY severity""", (day_ago,)
        ).fetchall()
    return {
        "total_events":  total_events,
        "events_24h":    events_24h,
        "open_alerts":   open_alerts,
        "critical_24h":  critical_24h,
        "agents_online": agents_online,
        "severity_dist": {r["severity"]: r["cnt"] for r in by_sev},
    }


def purge_old_data():
    cutoff_events = time.time() - config.EVENT_RETENTION_DAYS * 86400
    cutoff_alerts = time.time() - config.ALERT_RETENTION_DAYS * 86400
    with get_conn() as conn:
        conn.execute("DELETE FROM events WHERE timestamp < ?", (cutoff_events,))
        conn.execute("DELETE FROM alerts WHERE created_at < ? AND status != 'OPEN'", (cutoff_alerts,))
    logger.info("Purged old data (events>%dd, alerts>%dd)", config.EVENT_RETENTION_DAYS, config.ALERT_RETENTION_DAYS)


# ── Default Rules Seed ─────────────────────────────────────────────────────

def _seed_default_rules():
    defaults = [
        {
            "id": "brute_force_ssh",
            "name": "SSH Brute Force",
            "description": "Detects multiple failed SSH login attempts from same IP within 1 minute",
            "severity": "HIGH",
            "enabled": 1,
            "conditions": json.dumps({
                "type": "threshold",
                "pattern": "Failed password",
                "count": 5,
                "window_sec": 60,
                "group_by": "source_ip"
            })
        },
        {
            "id": "brute_force_rdp",
            "name": "RDP Brute Force",
            "description": "Multiple failed RDP authentication attempts",
            "severity": "HIGH",
            "enabled": 1,
            "conditions": json.dumps({
                "type": "threshold",
                "pattern": "EventID:4625",
                "count": 10,
                "window_sec": 60,
                "group_by": "source_ip"
            })
        },
        {
            "id": "root_login",
            "name": "Root Login Detected",
            "description": "Direct root login via SSH",
            "severity": "CRITICAL",
            "enabled": 1,
            "conditions": json.dumps({
                "type": "pattern",
                "pattern": "Accepted.*root",
                "severity_override": "CRITICAL"
            })
        },
        {
            "id": "port_scan",
            "name": "Port Scan Activity",
            "description": "Detects rapid connections to multiple ports from single source",
            "severity": "MEDIUM",
            "enabled": 1,
            "conditions": json.dumps({
                "type": "port_scan",
                "unique_ports": 20,
                "window_sec": 30,
                "group_by": "source_ip"
            })
        },
        {
            "id": "sudo_escalation",
            "name": "Privilege Escalation via sudo",
            "description": "sudo command executed for privilege escalation",
            "severity": "MEDIUM",
            "enabled": 1,
            "conditions": json.dumps({
                "type": "pattern",
                "pattern": "sudo.*COMMAND"
            })
        },
        {
            "id": "malware_keyword",
            "name": "Malware Indicators",
            "description": "Log contains known malware-related keywords",
            "severity": "CRITICAL",
            "enabled": 1,
            "conditions": json.dumps({
                "type": "keyword",
                "keywords": ["malware", "ransomware", "trojan", "backdoor", "rootkit", "exploit"]
            })
        },
        {
            "id": "new_user_created",
            "name": "New User Account Created",
            "description": "A new system user account was created",
            "severity": "MEDIUM",
            "enabled": 1,
            "conditions": json.dumps({
                "type": "pattern",
                "pattern": "new user:|useradd|EventID:4720"
            })
        },
        {
            "id": "firewall_drop",
            "name": "Firewall Blocks Spike",
            "description": "High volume of firewall DROP events",
            "severity": "LOW",
            "enabled": 1,
            "conditions": json.dumps({
                "type": "threshold",
                "pattern": "IPTABLES.*DROP|firewall.*block",
                "count": 50,
                "window_sec": 60,
                "group_by": "source_ip"
            })
        },
    ]
    for rule in defaults:
        with get_conn() as conn:
            exists = conn.execute("SELECT 1 FROM rules WHERE id=?", (rule["id"],)).fetchone()
            if not exists:
                conn.execute(
                    """INSERT INTO rules (id,name,description,severity,enabled,conditions)
                       VALUES (:id,:name,:description,:severity,:enabled,:conditions)""",
                    rule
                )
