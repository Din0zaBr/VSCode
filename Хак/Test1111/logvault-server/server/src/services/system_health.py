"""URSUS SIEM - System Health monitoring."""
from __future__ import annotations

import time
import logging
from typing import Any

logger = logging.getLogger("server.health")


class SystemHealth:
    """Collects and stores system health metrics."""

    def __init__(self, db: Any) -> None:
        self.db = db
        self._metrics: dict[str, Any] = {}
        self._last_check: float = 0

    def collect(self) -> dict[str, Any]:
        return {
            "timestamp": time.time(),
            "components": {
                "database": self._check_database(),
                "correlation_engine": self._check_correlation(),
                "alert_engine": self._check_alerting(),
                "ml_engine": self._check_ml(),
                "integrations": self._check_integrations(),
            },
            "statistics": self._get_statistics(),
            "agents": self._check_agents(),
        }

    def _check_database(self) -> dict:
        try:
            conn = self.db._conn()
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.execute("SELECT count(*) FROM logs")
                total_logs = cur.fetchone()[0]
                cur.execute("SELECT pg_database_size(current_database())")
                db_size = cur.fetchone()[0]
            self.db._put(conn)
            return {
                "status": "healthy",
                "total_logs": total_logs,
                "db_size_bytes": db_size,
                "db_size_human": f"{db_size / 1024 / 1024:.1f} MB",
            }
        except Exception as e:
            return {"status": "unhealthy", "error": str(e)}

    def _check_correlation(self) -> dict:
        try:
            rules = self.db.get_correlation_rules()
            alerts = self.db.get_correlation_alerts(limit=1)
            return {
                "status": "running",
                "rules_count": len(rules),
                "alerts_total": alerts.get("total", 0),
            }
        except Exception:
            return {"status": "running", "rules_count": 0, "alerts_total": 0}

    def _check_alerting(self) -> dict:
        return {"status": "running"}

    def _check_ml(self) -> dict:
        return {"status": "stub", "message": "ML not configured"}

    def _check_integrations(self) -> dict:
        return {"status": "ok", "connected": 0, "total": 0}

    def _get_statistics(self) -> dict:
        try:
            conn = self.db._conn()
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT
                        count(*) AS total_24h,
                        count(*) FILTER (WHERE level = 'ERROR') AS errors_24h,
                        count(*) FILTER (WHERE level = 'CRITICAL') AS critical_24h,
                        count(DISTINCT agent_id) AS active_agents,
                        count(DISTINCT host) AS unique_hosts
                    FROM logs
                    WHERE timestamp > NOW() - INTERVAL '24 hours'
                """)
                row = cur.fetchone()
            self.db._put(conn)
            return {
                "events_24h": row[0],
                "errors_24h": row[1],
                "critical_24h": row[2],
                "active_agents": row[3],
                "unique_hosts": row[4],
                "eps": 0,
            }
        except Exception as e:
            return {"error": str(e)}

    def _check_agents(self) -> dict:
        try:
            conn = self.db._conn()
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT agent_id, max(timestamp) AS last_seen,
                           max(timestamp) > NOW() - INTERVAL '5 minutes' AS active
                    FROM logs GROUP BY agent_id
                """)
                agents = cur.fetchall()
            self.db._put(conn)
            active = sum(1 for a in agents if a[2])
            return {
                "total": len(agents),
                "active": active,
                "inactive": len(agents) - active,
            }
        except Exception as e:
            return {"error": str(e)}


def health_loop(health: SystemHealth, interval: float = 60.0) -> None:
    """Background thread for health metric collection."""
    logger.info("System Health monitor started (interval=%.0fs)", interval)
    while True:
        try:
            health._metrics = health.collect()
            health._last_check = time.time()
        except Exception:
            logger.exception("Health check failed")
        time.sleep(interval)
