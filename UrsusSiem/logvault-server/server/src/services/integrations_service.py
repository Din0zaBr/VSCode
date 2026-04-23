"""URSUS SIEM - Integration sync management service."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("server.services.integrations")

_SYNC_LOG: list[dict] = []
_MAX_SYNC_LOG = 500


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sync_integration(registry: Any, name: str, pipeline: Any | None = None) -> dict:
    """Pull events from a named integration and optionally push to ingest pipeline."""
    integration = registry.get(name)
    if not integration:
        return {"ok": False, "error": f"Integration '{name}' not found"}

    started = _now()
    try:
        events = integration.pull_events()
        count = len(events)

        if pipeline and events:
            for event in events:
                try:
                    pipeline.ingest(event)
                except Exception as exc:
                    logger.warning("Pipeline ingest failed for %s: %s", name, exc)

        entry = {
            "integration": name,
            "started_at": started,
            "finished_at": _now(),
            "events_pulled": count,
            "status": "ok",
            "error": None,
        }
    except Exception as exc:
        entry = {
            "integration": name,
            "started_at": started,
            "finished_at": _now(),
            "events_pulled": 0,
            "status": "error",
            "error": str(exc),
        }
        logger.error("Sync failed for integration %s: %s", name, exc)

    _SYNC_LOG.append(entry)
    if len(_SYNC_LOG) > _MAX_SYNC_LOG:
        del _SYNC_LOG[: len(_SYNC_LOG) - _MAX_SYNC_LOG]

    return entry


def sync_all(registry: Any, pipeline: Any | None = None) -> list[dict]:
    """Sync all integrations that are in the registry."""
    results = []
    for integration_status in registry.list_all():
        name = integration_status.get("name")
        if name:
            result = sync_integration(registry, name, pipeline)
            results.append(result)
    return results


def get_sync_log(integration: str = "", limit: int = 100) -> list[dict]:
    logs = list(reversed(_SYNC_LOG))
    if integration:
        logs = [e for e in logs if e["integration"] == integration]
    return logs[:limit]


def get_sync_stats() -> dict:
    if not _SYNC_LOG:
        return {"total_syncs": 0, "total_events": 0, "last_sync": None, "errors": 0}
    return {
        "total_syncs": len(_SYNC_LOG),
        "total_events": sum(e["events_pulled"] for e in _SYNC_LOG),
        "last_sync": _SYNC_LOG[-1]["finished_at"] if _SYNC_LOG else None,
        "errors": sum(1 for e in _SYNC_LOG if e["status"] == "error"),
    }
