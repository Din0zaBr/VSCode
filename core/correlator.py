"""
Ursus Insight SIEM - Correlation Engine
Evaluates rules against recent events and fires alerts.
"""
import re
import json
import time
import logging
import threading
from collections import defaultdict, deque

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import config
from core import database

logger = logging.getLogger("ursus.correlator")


class CorrelationEngine(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True, name="Correlator")
        self._stop = threading.Event()
        # sliding window buffers: rule_id -> deque of (ts, source_ip, event_id)
        self._windows: dict[str, deque] = defaultdict(deque)
        # cooldown tracking: rule_id+source_ip -> last_alert_ts
        self._cooldowns: dict[str, float] = {}
        self._cooldown_sec = 300  # 5 min between same rule+source alerts

    def run(self):
        logger.info("Correlation engine started (interval=%ds)", config.CORRELATOR_INTERVAL_SEC)
        while not self._stop.is_set():
            self._stop.wait(config.CORRELATOR_INTERVAL_SEC)
            if not self._stop.is_set():
                self._evaluate()

    def _evaluate(self):
        rules = database.get_rules(enabled_only=True)
        now = time.time()

        # Fetch recent events (last 10 minutes)
        recent_events = database.get_events(
            limit=2000,
            since=now - 600
        )

        for rule in rules:
            try:
                cond = json.loads(rule["conditions"])
                rule_type = cond.get("type", "pattern")

                if rule_type == "threshold":
                    self._eval_threshold(rule, cond, recent_events, now)
                elif rule_type == "pattern":
                    self._eval_pattern(rule, cond, recent_events, now)
                elif rule_type == "keyword":
                    self._eval_keyword(rule, cond, recent_events, now)
                elif rule_type == "port_scan":
                    self._eval_port_scan(rule, cond, recent_events, now)
            except Exception as e:
                logger.error("Error evaluating rule %s: %s", rule["id"], e)

    def _can_fire(self, rule_id: str, source_ip: str) -> bool:
        key = f"{rule_id}:{source_ip or 'any'}"
        last = self._cooldowns.get(key, 0)
        if time.time() - last > self._cooldown_sec:
            self._cooldowns[key] = time.time()
            return True
        return False

    def _fire_alert(self, rule, source_ip, description, event_ids):
        if not self._can_fire(rule["id"], source_ip):
            return
        aid = database.insert_alert(
            rule_id=rule["id"],
            rule_name=rule["name"],
            severity=rule["severity"],
            source_ip=source_ip,
            description=description,
            event_ids=event_ids,
        )
        database.increment_rule_hits(rule["id"])
        logger.warning("ALERT [%s] %s | src=%s | alert_id=%d",
                       rule["severity"], rule["name"], source_ip, aid)

    # ── Rule type: threshold ─────────────────────────────────────────────────
    def _eval_threshold(self, rule, cond, events, now):
        pattern = re.compile(cond["pattern"], re.IGNORECASE)
        window = cond.get("window_sec", 60)
        threshold = cond.get("count", 5)
        group_by = cond.get("group_by", "source_ip")

        cutoff = now - window
        buckets: dict[str, list] = defaultdict(list)

        for ev in events:
            if ev["timestamp"] < cutoff:
                continue
            if not pattern.search(ev["raw_message"]):
                continue
            key = ev.get(group_by) or "unknown"
            buckets[key].append(ev["id"])

        for key, ids in buckets.items():
            if len(ids) >= threshold:
                self._fire_alert(
                    rule,
                    source_ip=key if group_by == "source_ip" else None,
                    description=(
                        f"{rule['name']}: {len(ids)} occurrences of "
                        f"'{cond['pattern']}' from {key} in {window}s"
                    ),
                    event_ids=ids[-20:],
                )

    # ── Rule type: pattern ───────────────────────────────────────────────────
    def _eval_pattern(self, rule, cond, events, now):
        pattern = re.compile(cond["pattern"], re.IGNORECASE)
        window = cond.get("window_sec", 600)
        cutoff = now - window

        for ev in events:
            if ev["timestamp"] < cutoff:
                continue
            if pattern.search(ev["raw_message"]):
                self._fire_alert(
                    rule,
                    source_ip=ev.get("source_ip"),
                    description=f"{rule['name']}: matched pattern in event from {ev.get('source_ip','?')}",
                    event_ids=[ev["id"]],
                )

    # ── Rule type: keyword ───────────────────────────────────────────────────
    def _eval_keyword(self, rule, cond, events, now):
        keywords = [k.lower() for k in cond.get("keywords", [])]
        window = cond.get("window_sec", 600)
        cutoff = now - window

        for ev in events:
            if ev["timestamp"] < cutoff:
                continue
            msg_lower = ev["raw_message"].lower()
            matched = [kw for kw in keywords if kw in msg_lower]
            if matched:
                self._fire_alert(
                    rule,
                    source_ip=ev.get("source_ip"),
                    description=(
                        f"{rule['name']}: keywords {matched} found in event "
                        f"from {ev.get('source_ip','?')}"
                    ),
                    event_ids=[ev["id"]],
                )

    # ── Rule type: port_scan ─────────────────────────────────────────────────
    def _eval_port_scan(self, rule, cond, events, now):
        window = cond.get("window_sec", 30)
        threshold_ports = cond.get("unique_ports", 20)
        cutoff = now - window

        port_re = re.compile(r"DPT=(\d+)|port[=:\s]+(\d+)", re.IGNORECASE)

        # group by source_ip -> set of destination ports
        buckets: dict[str, dict] = defaultdict(lambda: {"ports": set(), "ids": []})

        for ev in events:
            if ev["timestamp"] < cutoff:
                continue
            src = ev.get("source_ip")
            if not src:
                continue
            m = port_re.search(ev["raw_message"])
            if m:
                port = m.group(1) or m.group(2)
                buckets[src]["ports"].add(port)
                buckets[src]["ids"].append(ev["id"])

        for src, data in buckets.items():
            if len(data["ports"]) >= threshold_ports:
                self._fire_alert(
                    rule,
                    source_ip=src,
                    description=(
                        f"{rule['name']}: {src} scanned {len(data['ports'])} ports in {window}s"
                    ),
                    event_ids=data["ids"][-20:],
                )

    def stop(self):
        self._stop.set()
