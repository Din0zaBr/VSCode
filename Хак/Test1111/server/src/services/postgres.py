from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool

from server.src.config import settings

logger = logging.getLogger("server.pg")

INTERVAL_MAP = {
    "1m": "1 minute",
    "5m": "5 minutes",
    "15m": "15 minutes",
    "30m": "30 minutes",
    "1h": "1 hour",
    "6h": "6 hours",
    "12h": "12 hours",
    "1d": "1 day",
}


def _parse_relative_ts(value: str) -> str | None:
    """Convert ES-style 'now-5m' to ISO timestamp, or return value as-is if already ISO."""
    if not value:
        return None
    if value.startswith("now"):
        suffix = value[3:]
        if not suffix:
            return datetime.now(timezone.utc).isoformat()
        if suffix.startswith("-") and suffix[-1] in ("m", "h", "d"):
            amount = int(suffix[1:-1])
            unit = suffix[-1]
            delta = {"m": timedelta(minutes=amount), "h": timedelta(hours=amount), "d": timedelta(days=amount)}[unit]
            return (datetime.now(timezone.utc) - delta).isoformat()
    return value


class PGService:
    def __init__(self) -> None:
        self.pool = ThreadedConnectionPool(2, 10, settings.DATABASE_URL)
        logger.info("PostgreSQL connection pool created")

    def _conn(self):
        return self.pool.getconn()

    def _put(self, conn):
        self.pool.putconn(conn)

    def _get_or_create_service(self, conn, service_name: str) -> int | None:
        if not service_name:
            return None
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO services (name) VALUES (%s) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id",
                (service_name,),
            )
            return cur.fetchone()[0]

    def bulk_index(self, docs: list[dict[str, Any]]) -> tuple[int, int]:
        conn = self._conn()
        success, errors = 0, 0
        try:
            with conn.cursor() as cur:
                for doc in docs:
                    try:
                        service_name = doc.get("service", "")
                        service_id = self._get_or_create_service(conn, service_name)

                        cur.execute(
                            """INSERT INTO logs (event_id, timestamp, host, agent_id, source, level, message, service_id, meta)
                               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                               ON CONFLICT (event_id) DO NOTHING""",
                            (
                                doc.get("event_id", ""),
                                doc.get("timestamp"),
                                doc.get("host", ""),
                                doc.get("agent_id", ""),
                                doc.get("source", ""),
                                doc.get("level", "INFO"),
                                doc.get("message", ""),
                                service_id,
                                json.dumps(doc.get("meta", {})),
                            ),
                        )
                        success += 1
                    except Exception:
                        logger.exception("Failed to insert doc %s", doc.get("event_id"))
                        errors += 1
            conn.commit()
        except Exception:
            logger.exception("Bulk insert failed")
            conn.rollback()
            errors = len(docs)
        finally:
            self._put(conn)
        return success, errors

    def search(
        self,
        q: str = "",
        level: str = "",
        agent_id: str = "",
        service: str = "",
        host: str = "",
        source: str = "",
        from_ts: str = "",
        to_ts: str = "",
        page: int = 1,
        size: int = 50,
        allowed_agents: list[str] | None = None,
    ) -> dict[str, Any]:
        conditions: list[str] = []
        params: list[Any] = []

        if allowed_agents is not None:
            if not allowed_agents:
                return {"total": 0, "logs": []}
            conditions.append("l.agent_id = ANY(%s)")
            params.append(allowed_agents)

        if q:
            conditions.append("to_tsvector('simple', l.message) @@ plainto_tsquery('simple', %s)")
            params.append(q)
        if level:
            levels = [lv.strip().upper() for lv in level.split(",")]
            conditions.append(f"l.level = ANY(%s)")
            params.append(levels)
        if agent_id:
            conditions.append("l.agent_id = %s")
            params.append(agent_id)
        if service:
            conditions.append("s.name = %s")
            params.append(service)
        if host:
            conditions.append("l.host = %s")
            params.append(host)
        if source:
            conditions.append("l.source = %s")
            params.append(source)

        ts_from = _parse_relative_ts(from_ts)
        ts_to = _parse_relative_ts(to_ts)
        if ts_from:
            conditions.append("l.timestamp >= %s")
            params.append(ts_from)
        if ts_to:
            conditions.append("l.timestamp <= %s")
            params.append(ts_to)

        where = " AND ".join(conditions) if conditions else "TRUE"
        offset = (page - 1) * size

        conn = self._conn()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    f"SELECT count(*) AS total FROM logs l LEFT JOIN services s ON l.service_id = s.id WHERE {where}",
                    params,
                )
                total = cur.fetchone()["total"]

                cur.execute(
                    f"""SELECT l.event_id, l.timestamp, l.host, l.agent_id, l.source,
                               l.level, l.message, COALESCE(s.name, '') AS service, l.meta
                        FROM logs l LEFT JOIN services s ON l.service_id = s.id
                        WHERE {where}
                        ORDER BY l.timestamp DESC
                        LIMIT %s OFFSET %s""",
                    params + [size, offset],
                )
                rows = cur.fetchall()

            logs = []
            for r in rows:
                logs.append({
                    "event_id": r["event_id"],
                    "timestamp": r["timestamp"].isoformat() if hasattr(r["timestamp"], "isoformat") else str(r["timestamp"]),
                    "host": r["host"],
                    "agent_id": r["agent_id"],
                    "source": r["source"],
                    "level": r["level"],
                    "message": r["message"],
                    "service": r["service"],
                    "meta": r["meta"] if isinstance(r["meta"], dict) else json.loads(r["meta"]) if r["meta"] else {},
                })
            return {"total": total, "logs": logs}
        finally:
            self._put(conn)

    def get_stats(
        self,
        interval: str = "1h",
        from_ts: str = "",
        to_ts: str = "",
        agent_id: str = "",
        service: str = "",
        allowed_agents: list[str] | None = None,
    ) -> dict[str, Any]:
        conditions: list[str] = []
        params: list[Any] = []

        if allowed_agents is not None:
            if not allowed_agents:
                return {"over_time": [], "by_level": [], "by_service": [], "by_agent": [], "by_host": [], "by_source": [], "heatmap": []}
            conditions.append("l.agent_id = ANY(%s)")
            params.append(allowed_agents)

        if agent_id:
            conditions.append("l.agent_id = %s")
            params.append(agent_id)
        if service:
            conditions.append("s.name = %s")
            params.append(service)

        ts_from = _parse_relative_ts(from_ts)
        ts_to = _parse_relative_ts(to_ts)
        if ts_from:
            conditions.append("l.timestamp >= %s")
            params.append(ts_from)
        if ts_to:
            conditions.append("l.timestamp <= %s")
            params.append(ts_to)

        where = " AND ".join(conditions) if conditions else "TRUE"
        pg_interval = INTERVAL_MAP.get(interval, "1 hour")

        conn = self._conn()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    f"""SELECT date_bin(%s::interval, l.timestamp, '2000-01-01'::timestamptz) AS bucket,
                               l.level, count(*) AS doc_count
                        FROM logs l LEFT JOIN services s ON l.service_id = s.id
                        WHERE {where}
                        GROUP BY bucket, l.level
                        ORDER BY bucket""",
                    [pg_interval] + params,
                )
                over_time_raw = cur.fetchall()

                cur.execute(
                    f"SELECT l.level AS key, count(*) AS doc_count FROM logs l LEFT JOIN services s ON l.service_id = s.id WHERE {where} GROUP BY l.level",
                    params,
                )
                by_level = [dict(r) for r in cur.fetchall()]

                cur.execute(
                    f"SELECT COALESCE(s.name, '') AS key, count(*) AS doc_count FROM logs l LEFT JOIN services s ON l.service_id = s.id WHERE {where} GROUP BY s.name ORDER BY doc_count DESC LIMIT 20",
                    params,
                )
                by_service = [dict(r) for r in cur.fetchall()]

                cur.execute(
                    f"SELECT l.agent_id AS key, count(*) AS doc_count FROM logs l LEFT JOIN services s ON l.service_id = s.id WHERE {where} GROUP BY l.agent_id ORDER BY doc_count DESC LIMIT 50",
                    params,
                )
                by_agent = [dict(r) for r in cur.fetchall()]

                cur.execute(
                    f"SELECT l.host AS key, count(*) AS doc_count FROM logs l LEFT JOIN services s ON l.service_id = s.id WHERE {where} GROUP BY l.host ORDER BY doc_count DESC LIMIT 50",
                    params,
                )
                by_host = [dict(r) for r in cur.fetchall()]

                cur.execute(
                    f"SELECT l.source AS key, count(*) AS doc_count FROM logs l LEFT JOIN services s ON l.service_id = s.id WHERE {where} GROUP BY l.source ORDER BY doc_count DESC LIMIT 50",
                    params,
                )
                by_source = [dict(r) for r in cur.fetchall()]

                cur.execute(
                    f"""SELECT date_trunc('hour', l.timestamp) AS bucket, count(*) AS doc_count
                        FROM logs l LEFT JOIN services s ON l.service_id = s.id
                        WHERE {where}
                        GROUP BY bucket ORDER BY bucket""",
                    params,
                )
                heatmap_raw = cur.fetchall()

            buckets_map: dict[str, dict] = {}
            for row in over_time_raw:
                ts_key = row["bucket"].isoformat() if hasattr(row["bucket"], "isoformat") else str(row["bucket"])
                epoch_ms = int(row["bucket"].timestamp() * 1000) if hasattr(row["bucket"], "timestamp") else 0
                if ts_key not in buckets_map:
                    buckets_map[ts_key] = {
                        "key": epoch_ms,
                        "key_as_string": ts_key,
                        "doc_count": 0,
                        "by_level": {"buckets": []},
                    }
                buckets_map[ts_key]["doc_count"] += row["doc_count"]
                buckets_map[ts_key]["by_level"]["buckets"].append({
                    "key": row["level"],
                    "doc_count": row["doc_count"],
                })
            over_time = list(buckets_map.values())

            heatmap = []
            for row in heatmap_raw:
                ts = row["bucket"]
                heatmap.append({
                    "key": int(ts.timestamp() * 1000) if hasattr(ts, "timestamp") else 0,
                    "key_as_string": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                    "doc_count": row["doc_count"],
                })

            return {
                "over_time": over_time,
                "by_level": by_level,
                "by_service": by_service,
                "by_agent": by_agent,
                "by_host": by_host,
                "by_source": by_source,
                "heatmap": heatmap,
            }
        finally:
            self._put(conn)

    def get_agents(self) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """SELECT agent_id,
                              count(*) AS doc_count,
                              max(timestamp) AS last_seen,
                              (array_agg(host ORDER BY timestamp DESC))[1] AS host,
                              max(timestamp) > now() - interval '5 minutes' AS active
                       FROM logs
                       GROUP BY agent_id
                       ORDER BY last_seen DESC"""
                )
                rows = cur.fetchall()
            return [
                {
                    "agent_id": r["agent_id"],
                    "doc_count": r["doc_count"],
                    "last_seen": r["last_seen"].isoformat() if hasattr(r["last_seen"], "isoformat") else str(r["last_seen"]),
                    "host": r["host"] or "",
                    "active": bool(r["active"]),
                }
                for r in rows
            ]
        finally:
            self._put(conn)

    def get_hosts(self) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """SELECT l.host,
                              count(DISTINCT l.agent_id) AS agent_count,
                              count(*) AS doc_count,
                              max(l.timestamp) AS last_seen
                       FROM logs l
                       WHERE l.host != ''
                       GROUP BY l.host
                       ORDER BY last_seen DESC"""
                )
                rows = cur.fetchall()
            return [
                {
                    "host": r["host"],
                    "agent_count": r["agent_count"],
                    "doc_count": r["doc_count"],
                    "last_seen": r["last_seen"].isoformat() if hasattr(r["last_seen"], "isoformat") else str(r["last_seen"]),
                }
                for r in rows
            ]
        finally:
            self._put(conn)

    def get_user_by_username(self, username: str) -> dict[str, Any] | None:
        conn = self._conn()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT id, username, password, role FROM users WHERE username = %s",
                    (username,),
                )
                row = cur.fetchone()
            return dict(row) if row else None
        finally:
            self._put(conn)

    def create_default_admin(self) -> None:
        conn = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM users WHERE username = 'admin'")
                if cur.fetchone():
                    cur.execute("UPDATE users SET role = 'admin' WHERE username = 'admin'")
                    conn.commit()
                    return
                hashed = bcrypt.hashpw(b"admin", bcrypt.gensalt()).decode()
                cur.execute(
                    "INSERT INTO users (username, password, role) VALUES (%s, %s, 'admin') ON CONFLICT (username) DO NOTHING",
                    ("admin", hashed),
                )
            conn.commit()
            logger.info("Default admin user created")
        except Exception:
            logger.exception("Failed to create default admin")
            conn.rollback()
        finally:
            self._put(conn)

    def get_user_agents(self, user_id: int) -> list[str]:
        conn = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT agent_id FROM user_agents WHERE user_id = %s", (user_id,))
                return [r[0] for r in cur.fetchall()]
        finally:
            self._put(conn)

    def set_user_agents(self, user_id: int, agent_ids: list[str]) -> None:
        conn = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM user_agents WHERE user_id = %s", (user_id,))
                for aid in agent_ids:
                    cur.execute(
                        "INSERT INTO user_agents (user_id, agent_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                        (user_id, aid),
                    )
            conn.commit()
        finally:
            self._put(conn)

    def list_users(self) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """SELECT u.id, u.username, u.role, u.created_at,
                              COALESCE(array_agg(ua.agent_id) FILTER (WHERE ua.agent_id IS NOT NULL), '{}') AS agents
                       FROM users u
                       LEFT JOIN user_agents ua ON u.id = ua.user_id
                       GROUP BY u.id
                       ORDER BY u.created_at"""
                )
                rows = cur.fetchall()
            return [
                {
                    "id": r["id"],
                    "username": r["username"],
                    "role": r["role"],
                    "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else str(r["created_at"]),
                    "agents": list(r["agents"]) if r["agents"] else [],
                }
                for r in rows
            ]
        finally:
            self._put(conn)

    def create_user(self, username: str, password: str, role: str) -> dict[str, Any]:
        conn = self._conn()
        try:
            hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "INSERT INTO users (username, password, role) VALUES (%s, %s, %s) RETURNING id, username, role",
                    (username, hashed, role),
                )
                row = cur.fetchone()
            conn.commit()
            return dict(row)
        except psycopg2.errors.UniqueViolation:
            conn.rollback()
            raise ValueError("Username already exists")
        finally:
            self._put(conn)

    def delete_user(self, user_id: int) -> bool:
        conn = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM users WHERE id = %s", (user_id,))
                deleted = cur.rowcount > 0
            conn.commit()
            return deleted
        finally:
            self._put(conn)

    def get_latest_metrics(self, allowed_agents: list[str] | None = None) -> list[dict[str, Any]]:
        conn = self._conn()
        try:
            conditions = ["l.source = 'metrics'", "l.meta->>'metric_type' = 'system_snapshot'"]
            params: list[Any] = []

            if allowed_agents is not None:
                if not allowed_agents:
                    return []
                conditions.append("l.agent_id = ANY(%s)")
                params.append(allowed_agents)

            where = " AND ".join(conditions)

            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    f"""SELECT DISTINCT ON (l.agent_id)
                               l.agent_id, l.host, l.timestamp, l.meta
                        FROM logs l
                        WHERE {where}
                        ORDER BY l.agent_id, l.timestamp DESC""",
                    params,
                )
                rows = cur.fetchall()

            result = []
            for r in rows:
                meta = r["meta"] if isinstance(r["meta"], dict) else json.loads(r["meta"]) if r["meta"] else {}
                result.append({
                    "agent_id": r["agent_id"],
                    "host": r["host"] or "",
                    "timestamp": r["timestamp"].isoformat() if hasattr(r["timestamp"], "isoformat") else str(r["timestamp"]),
                    "cpu": meta.get("cpu", {}),
                    "memory": meta.get("memory", {}),
                    "disk": meta.get("disk", []),
                    "load_average": meta.get("load_average", {}),
                    "uptime": meta.get("uptime", {}),
                    "distro": meta.get("distro", {}),
                })
            return result
        finally:
            self._put(conn)

    def update_user_role(self, user_id: int, role: str) -> bool:
        conn = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute("UPDATE users SET role = %s WHERE id = %s", (role, user_id))
                updated = cur.rowcount > 0
            conn.commit()
            return updated
        finally:
            self._put(conn)
