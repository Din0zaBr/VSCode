"""URSUS SIEM - Reports API (HTML export, basic metrics)."""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from server.src.auth import verify_token

router = APIRouter(prefix="/reports", tags=["reports"])

REPORT_TYPES = ["incidents", "threats", "agents", "access"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _fmt(dt: datetime) -> str:
    return dt.strftime("%d.%m.%Y %H:%M")


# ── HTML report generation ────────────────────────────────────────────────────

def _html_table(headers: list[str], rows: list[list]) -> str:
    th = "".join(f"<th>{h}</th>" for h in headers)
    body = ""
    for row in rows:
        td = "".join(f"<td>{c}</td>" for c in row)
        body += f"<tr>{td}</tr>"
    return f"""<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px">
    <thead style="background:#1a0a2e;color:#BF40BF"><tr>{th}</tr></thead>
    <tbody>{body}</tbody>
</table>"""


def _html_wrap(title: str, body: str, date_range: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>{title}</title>
<style>
  body {{ font-family: 'Segoe UI', sans-serif; background:#f5f5f5; color:#333; padding:24px; }}
  h1 {{ color:#6A0DAD; border-bottom:2px solid #6A0DAD; padding-bottom:8px; }}
  h2 {{ color:#4a0878; margin-top:24px; }}
  .meta {{ color:#888; font-size:12px; margin-bottom:16px; }}
  table {{ margin-top:8px; margin-bottom:24px; }}
  th {{ text-align:left; padding:8px; }}
  td {{ padding:6px 8px; border-bottom:1px solid #ddd; }}
  tr:nth-child(even) {{ background:#f9f9f9; }}
</style>
</head>
<body>
<h1>URSUS SIEM — {title}</h1>
<div class="meta">Сформирован: {_fmt(datetime.now(timezone.utc))} · Период: {date_range}</div>
{body}
</body>
</html>"""


def _build_incidents_html(db: Any, from_dt: datetime, to_dt: datetime) -> str:
    try:
        alerts = db.get_correlation_alerts(limit=1000)
        if alerts is None:
            alerts = []
    except Exception:
        alerts = []

    filtered = [a for a in alerts if hasattr(a, "__iter__") or isinstance(a, dict)]

    def _v(a: Any, key: str, default: str = "") -> str:
        if isinstance(a, dict):
            return str(a.get(key, default))
        return str(getattr(a, key, default))

    rows = [[_v(a, "id", "")[:8], _v(a, "rule_name"), _v(a, "severity"), _v(a, "status"), _v(a, "created_at", "")[:19]] for a in filtered[:200]]
    table = _html_table(["ID", "Инцидент", "Критичность", "Статус", "Время"], rows) if rows else "<p>Нет данных</p>"
    return f"<h2>Инциденты ({len(rows)})</h2>{table}"


def _build_csv(headers: list[str], rows: list[list]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(headers)
    w.writerows(rows)
    return buf.getvalue()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/types")
async def list_report_types(user: dict = Depends(verify_token)):
    return REPORT_TYPES


@router.get("/html/{report_type}")
async def export_html(
    report_type: str,
    from_ts: str = Query(""),
    to_ts: str = Query(""),
    request: Request = None,
    user: dict = Depends(verify_token),
):
    if report_type not in REPORT_TYPES:
        raise HTTPException(400, f"Unknown report type: {report_type}. Valid: {REPORT_TYPES}")

    db = request.app.state.db_service
    now = datetime.now(timezone.utc)
    from_dt = datetime.fromisoformat(from_ts) if from_ts else now - timedelta(hours=24)
    to_dt = datetime.fromisoformat(to_ts) if to_ts else now
    date_range = f"{_fmt(from_dt)} — {_fmt(to_dt)}"

    titles = {
        "incidents": "Отчёт по инцидентам",
        "threats": "Анализ угроз",
        "agents": "Активность агентов",
        "access": "Аудит доступа",
    }

    if report_type == "incidents":
        body = _build_incidents_html(db, from_dt, to_dt)
    elif report_type == "threats":
        body = "<h2>Анализ угроз</h2><p>Данные по категориям угроз за период.</p>"
    elif report_type == "agents":
        try:
            agents = db.get_agents() or []
        except Exception:
            agents = []
        rows = [[str(getattr(a, "agent_id", a.get("agent_id", "") if isinstance(a, dict) else ""))[:16],
                 str(getattr(a, "host", a.get("host", "") if isinstance(a, dict) else "")),
                 "Активен" if getattr(a, "active", a.get("active", False) if isinstance(a, dict) else False) else "Не активен"]
                for a in agents[:100]]
        body = f"<h2>Агенты ({len(rows)})</h2>{_html_table(['ID', 'Хост', 'Статус'], rows) if rows else '<p>Нет данных</p>'}"
    else:
        body = "<h2>Аудит доступа</h2><p>Журнал операций доступа за период.</p>"

    html = _html_wrap(titles[report_type], body, date_range)
    filename = f"ursus-{report_type}-{now.strftime('%Y%m%d-%H%M')}.html"
    return Response(
        content=html,
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/csv/{report_type}")
async def export_csv(
    report_type: str,
    from_ts: str = Query(""),
    to_ts: str = Query(""),
    request: Request = None,
    user: dict = Depends(verify_token),
):
    if report_type not in REPORT_TYPES:
        raise HTTPException(400, f"Unknown report type: {report_type}")

    db = request.app.state.db_service
    now = datetime.now(timezone.utc)

    if report_type == "agents":
        try:
            agents = db.get_agents() or []
        except Exception:
            agents = []
        headers = ["agent_id", "host", "active"]
        rows = [[
            str(getattr(a, "agent_id", a.get("agent_id", "") if isinstance(a, dict) else "")),
            str(getattr(a, "host", a.get("host", "") if isinstance(a, dict) else "")),
            str(getattr(a, "active", a.get("active", "") if isinstance(a, dict) else "")),
        ] for a in agents]
    else:
        try:
            alerts = db.get_correlation_alerts(limit=1000) or []
        except Exception:
            alerts = []
        headers = ["id", "rule_name", "severity", "status", "created_at"]
        rows = [[
            str(getattr(a, "id", a.get("id", "") if isinstance(a, dict) else ""))[:8],
            str(getattr(a, "rule_name", a.get("rule_name", "") if isinstance(a, dict) else "")),
            str(getattr(a, "severity", a.get("severity", "") if isinstance(a, dict) else "")),
            str(getattr(a, "status", a.get("status", "") if isinstance(a, dict) else "")),
            str(getattr(a, "created_at", a.get("created_at", "") if isinstance(a, dict) else ""))[:19],
        ] for a in alerts[:1000]]

    csv_content = _build_csv(headers, rows)
    filename = f"ursus-{report_type}-{now.strftime('%Y%m%d-%H%M')}.csv"
    return Response(
        content=csv_content.encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
