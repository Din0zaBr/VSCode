"""
Ursus Insight SIEM - REST API Routes
"""
import base64
import json
import time
import logging
import functools

from flask import Blueprint, jsonify, request, abort, Response, session

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import config
from core import database, collector, analyzer

logger = logging.getLogger("ursus.api")
api = Blueprint("api", __name__, url_prefix="/api")


def _require_agent_key():
    key = request.headers.get("X-Agent-Key") or request.args.get("key")
    if key != config.AGENT_API_KEY:
        abort(401, "Invalid agent API key")


def _require_web_auth():
    """Check session auth for browser-facing API endpoints."""
    if not session.get("logged_in"):
        abort(401, "Authentication required")


# ── Dashboard ─────────────────────────────────────────────────────────────────

@api.get("/dashboard/stats")
def dashboard_stats():
    _require_web_auth()
    return jsonify(database.get_dashboard_stats())


@api.get("/dashboard/timeline")
def dashboard_timeline():
    _require_web_auth()
    hours = int(request.args.get("hours", 24))
    return jsonify(database.get_events_by_hour(hours=hours))


@api.get("/dashboard/top-sources")
def dashboard_top_sources():
    _require_web_auth()
    hours = int(request.args.get("hours", 24))
    limit = int(request.args.get("limit", 10))
    since = time.time() - hours * 3600
    return jsonify(database.get_top_sources(limit=limit, since=since))


@api.get("/dashboard/categories")
def dashboard_categories():
    _require_web_auth()
    hours = int(request.args.get("hours", 24))
    since = time.time() - hours * 3600
    return jsonify(database.get_category_distribution(since=since))


# ── Events ────────────────────────────────────────────────────────────────────

@api.get("/events")
def get_events():
    _require_web_auth()
    limit  = min(int(request.args.get("limit", 100)), 500)
    offset = int(request.args.get("offset", 0))
    sev    = request.args.get("severity")
    cat    = request.args.get("category")
    src    = request.args.get("source_ip")
    search = request.args.get("search")
    since  = request.args.get("since")
    until  = request.args.get("until")

    if since:
        since = float(since)
    if until:
        until = float(until)

    events = database.get_events(
        limit=limit, offset=offset,
        severity=sev, category=cat,
        source_ip=src, search=search,
        since=since, until=until
    )
    total = database.count_events(since=since)
    return jsonify({"events": events, "total": total, "offset": offset})


@api.get("/events/<int:event_id>")
def get_event(event_id):
    _require_web_auth()
    events = database.get_events(limit=1, offset=0)
    # Simple fetch by id
    from core.database import get_conn
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
    if not row:
        abort(404)
    return jsonify(dict(row))


# ── Alerts ────────────────────────────────────────────────────────────────────

@api.get("/alerts")
def get_alerts():
    _require_web_auth()
    limit  = min(int(request.args.get("limit", 100)), 500)
    offset = int(request.args.get("offset", 0))
    status = request.args.get("status")
    sev    = request.args.get("severity")
    since  = float(request.args.get("since", 0)) or None

    alerts = database.get_alerts(limit=limit, offset=offset,
                                  status=status, severity=sev, since=since)
    total = database.count_alerts(status=status)
    return jsonify({"alerts": alerts, "total": total})


@api.patch("/alerts/<int:alert_id>")
def update_alert(alert_id):
    _require_web_auth()
    data = request.get_json(force=True)
    status = data.get("status")
    notes  = data.get("notes")
    valid_statuses = ("OPEN", "IN_PROGRESS", "RESOLVED", "FALSE_POSITIVE")
    if status and status not in valid_statuses:
        abort(400, f"Invalid status. Must be one of: {valid_statuses}")
    database.update_alert_status(alert_id, status, notes)
    return jsonify({"ok": True})


# ── Rules ─────────────────────────────────────────────────────────────────────

@api.get("/rules")
def get_rules():
    _require_web_auth()
    return jsonify(database.get_rules())


@api.put("/rules/<rule_id>")
def upsert_rule(rule_id):
    _require_web_auth()
    data = request.get_json(force=True)
    data["id"] = rule_id
    if "conditions" not in data:
        abort(400, "Missing 'conditions' field")
    if isinstance(data["conditions"], dict):
        data["conditions"] = json.dumps(data["conditions"])
    required = ("name", "severity", "enabled", "conditions")
    for field in required:
        if field not in data:
            abort(400, f"Missing field: {field}")
    database.upsert_rule(data)
    return jsonify({"ok": True})


@api.patch("/rules/<rule_id>/toggle")
def toggle_rule(rule_id):
    _require_web_auth()
    rules = database.get_rules()
    rule = next((r for r in rules if r["id"] == rule_id), None)
    if not rule:
        abort(404)
    new_state = 0 if rule["enabled"] else 1
    from core.database import get_conn
    with get_conn() as conn:
        conn.execute("UPDATE rules SET enabled=? WHERE id=?", (new_state, rule_id))
    return jsonify({"ok": True, "enabled": bool(new_state)})


# ── Agents ────────────────────────────────────────────────────────────────────

@api.get("/agents")
def get_agents():
    _require_web_auth()
    return jsonify(database.get_agents())


@api.post("/agent/register")
def agent_register():
    _require_agent_key()
    data = request.get_json(force=True)
    required = ("agent_id", "hostname")
    for f in required:
        if f not in data:
            abort(400, f"Missing: {f}")
    database.upsert_agent(
        agent_id=data["agent_id"],
        hostname=data["hostname"],
        ip=data.get("ip") or request.remote_addr,
        os_info=data.get("os_info", ""),
        version=data.get("version", "1.0"),
    )
    return jsonify({"ok": True, "siem_time": time.time()})


@api.post("/agent/ingest")
def agent_ingest():
    _require_agent_key()
    data = request.get_json(force=True)
    events = data.get("events", [])
    agent_id = data.get("agent_id")
    src_ip = data.get("source_ip") or request.remote_addr

    if not isinstance(events, list):
        abort(400, "'events' must be a list")

    accepted = 0
    for raw in events:
        if isinstance(raw, str) and raw.strip():
            if collector.submit_event(raw, src_ip, agent_id):
                accepted += 1

    # Update agent heartbeat
    if agent_id:
        from core.database import get_conn
        with get_conn() as conn:
            conn.execute(
                "UPDATE agents SET last_seen=?, status='ONLINE', events_sent=events_sent+? WHERE id=?",
                (time.time(), accepted, agent_id)
            )
    return jsonify({"ok": True, "accepted": accepted})


@api.post("/agent/heartbeat")
def agent_heartbeat():
    _require_agent_key()
    data = request.get_json(force=True)
    agent_id = data.get("agent_id")
    if agent_id:
        from core.database import get_conn
        with get_conn() as conn:
            conn.execute(
                "UPDATE agents SET last_seen=?, status='ONLINE' WHERE id=?",
                (time.time(), agent_id)
            )
    return jsonify({"ok": True})


# ── Charts (PNG images) ───────────────────────────────────────────────────────

@api.get("/charts/timeline")
def chart_timeline():
    _require_web_auth()
    hours = int(request.args.get("hours", 24))
    img_bytes = analyzer.chart_events_timeline(hours=hours)
    return Response(img_bytes, mimetype="image/png")


@api.get("/charts/severity")
def chart_severity():
    _require_web_auth()
    hours = int(request.args.get("hours", 24))
    img_bytes = analyzer.chart_severity_donut(hours=hours)
    return Response(img_bytes, mimetype="image/png")


@api.get("/charts/sources")
def chart_sources():
    _require_web_auth()
    hours = int(request.args.get("hours", 24))
    img_bytes = analyzer.chart_top_sources(hours=hours)
    return Response(img_bytes, mimetype="image/png")


@api.get("/charts/categories")
def chart_categories():
    _require_web_auth()
    hours = int(request.args.get("hours", 24))
    img_bytes = analyzer.chart_category_bar(hours=hours)
    return Response(img_bytes, mimetype="image/png")


# ── Misc ──────────────────────────────────────────────────────────────────────

@api.get("/status")
def system_status():
    return jsonify({
        "name": "Ursus Insight",
        "version": "1.0.0",
        "status": "running",
        "queue_size": collector.queue_size(),
        "uptime_ts": _start_time,
        "db_path": config.DB_PATH,
    })


_start_time = time.time()
