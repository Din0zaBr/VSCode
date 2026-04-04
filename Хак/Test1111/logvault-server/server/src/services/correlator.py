"""
URSUS SIEM - Correlation Engine.
Evaluates rules against recent events and fires alerts.
Ported from core/correlator.py, adapted for PostgreSQL backend.
"""
from __future__ import annotations

import re
import time
import logging
from collections import defaultdict
from typing import Any

logger = logging.getLogger("server.correlator")

# Cooldown: 5 min between same rule+source alerts
_COOLDOWN_SEC = 300
_cooldowns: dict[str, float] = {}


def _can_fire(rule_id: str, source_ip: str | None) -> bool:
    key = f"{rule_id}:{source_ip or 'any'}"
    last = _cooldowns.get(key, 0)
    if time.time() - last > _COOLDOWN_SEC:
        _cooldowns[key] = time.time()
        return True
    return False


def _fire_alert(db: Any, rule: dict, source_ip: str | None,
                description: str, event_ids: list) -> None:
    if not _can_fire(rule["id"], source_ip):
        return
    # Check exclusions before firing
    test_event = {"source_ip": source_ip, "rule_id": rule["id"]}
    if db.check_exclusion(test_event):
        logger.info("Alert suppressed by exclusion: rule=%s src=%s", rule["id"], source_ip)
        return
    aid = db.insert_correlation_alert(
        rule_id=rule["id"],
        rule_name=rule["name"],
        severity=rule["severity"],
        source_ip=source_ip,
        description=description,
        event_ids=event_ids,
    )
    db.increment_correlation_rule_hits(rule["id"])
    logger.warning("ALERT [%s] %s | src=%s | alert_id=%d",
                   rule["severity"], rule["name"], source_ip, aid)


def _eval_threshold(db: Any, rule: dict, cond: dict, events: list, now: float) -> None:
    pattern = re.compile(cond["pattern"], re.IGNORECASE)
    window = cond.get("window_sec", 60)
    threshold = cond.get("count", 5)
    group_by = cond.get("group_by", "source_ip")
    cutoff = now - window

    buckets: dict[str, list] = defaultdict(list)
    for ev in events:
        ts = ev["timestamp"]
        if hasattr(ts, "timestamp"):
            ts = ts.timestamp()
        if ts < cutoff:
            continue
        if not pattern.search(ev.get("raw_message", "") or ev.get("message", "")):
            continue
        key = ev.get(group_by) or ev.get("source_ip") or "unknown"
        buckets[key].append(ev.get("id", 0))

    for key, ids in buckets.items():
        if len(ids) >= threshold:
            _fire_alert(
                db, rule,
                source_ip=key if group_by == "source_ip" else None,
                description=f"{rule['name']}: {len(ids)} occurrences from {key} in {window}s",
                event_ids=ids[-20:],
            )


def _eval_pattern(db: Any, rule: dict, cond: dict, events: list, now: float) -> None:
    pattern = re.compile(cond["pattern"], re.IGNORECASE)
    window = cond.get("window_sec", 600)
    cutoff = now - window

    for ev in events:
        ts = ev["timestamp"]
        if hasattr(ts, "timestamp"):
            ts = ts.timestamp()
        if ts < cutoff:
            continue
        msg = ev.get("raw_message", "") or ev.get("message", "")
        if pattern.search(msg):
            _fire_alert(
                db, rule,
                source_ip=ev.get("source_ip"),
                description=f"{rule['name']}: matched pattern from {ev.get('source_ip', '?')}",
                event_ids=[ev.get("id", 0)],
            )


def _eval_keyword(db: Any, rule: dict, cond: dict, events: list, now: float) -> None:
    keywords = [k.lower() for k in cond.get("keywords", [])]
    window = cond.get("window_sec", 600)
    cutoff = now - window

    for ev in events:
        ts = ev["timestamp"]
        if hasattr(ts, "timestamp"):
            ts = ts.timestamp()
        if ts < cutoff:
            continue
        msg_lower = (ev.get("raw_message", "") or ev.get("message", "")).lower()
        matched = [kw for kw in keywords if kw in msg_lower]
        if matched:
            _fire_alert(
                db, rule,
                source_ip=ev.get("source_ip"),
                description=f"{rule['name']}: keywords {matched} from {ev.get('source_ip', '?')}",
                event_ids=[ev.get("id", 0)],
            )


def _eval_port_scan(db: Any, rule: dict, cond: dict, events: list, now: float) -> None:
    window = cond.get("window_sec", 30)
    threshold_ports = cond.get("unique_ports", 20)
    cutoff = now - window
    port_re = re.compile(r"DPT=(\d+)|port[=:\s]+(\d+)", re.IGNORECASE)

    buckets: dict[str, dict] = defaultdict(lambda: {"ports": set(), "ids": []})
    for ev in events:
        ts = ev["timestamp"]
        if hasattr(ts, "timestamp"):
            ts = ts.timestamp()
        if ts < cutoff:
            continue
        src = ev.get("source_ip")
        if not src:
            continue
        m = port_re.search(ev.get("raw_message", "") or ev.get("message", ""))
        if m:
            port = m.group(1) or m.group(2)
            buckets[src]["ports"].add(port)
            buckets[src]["ids"].append(ev.get("id", 0))

    for src, data in buckets.items():
        if len(data["ports"]) >= threshold_ports:
            _fire_alert(
                db, rule,
                source_ip=src,
                description=f"{rule['name']}: {src} scanned {len(data['ports'])} ports in {window}s",
                event_ids=data["ids"][-20:],
            )


def _evaluate(db: Any) -> None:
    import json
    rules = db.get_correlation_rules(enabled_only=True)
    events = db.get_recent_logs_for_correlation(since_seconds=600, limit=2000)
    now = time.time()

    for rule in rules:
        try:
            cond = rule["conditions"]
            if isinstance(cond, str):
                cond = json.loads(cond)
            rule_type = cond.get("type", "pattern")

            if rule_type == "threshold":
                _eval_threshold(db, rule, cond, events, now)
            elif rule_type == "pattern":
                _eval_pattern(db, rule, cond, events, now)
            elif rule_type == "keyword":
                _eval_keyword(db, rule, cond, events, now)
            elif rule_type == "port_scan":
                _eval_port_scan(db, rule, cond, events, now)
        except Exception:
            logger.exception("Error evaluating rule %s", rule.get("id"))


def correlation_loop(db: Any, interval: float = 10.0) -> None:
    """Background thread: evaluate correlation rules periodically."""
    logger.info("Correlation engine started (interval=%.0fs)", interval)
    while True:
        try:
            _evaluate(db)
        except Exception:
            logger.exception("Correlation loop error")
        time.sleep(interval)
