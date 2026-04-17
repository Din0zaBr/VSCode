"""URSUS SIEM - Background task for periodic integration sync."""
from __future__ import annotations

import logging
import time
from typing import Any

from server.src.services.integrations_service import sync_all

logger = logging.getLogger("server.tasks.sync_integrations")

DEFAULT_INTERVAL = 300  # seconds between sync runs


def integration_sync_loop(
    registry: Any,
    pipeline: Any | None = None,
    interval: int = DEFAULT_INTERVAL,
) -> None:
    """Background loop that periodically syncs all integrations.

    Intended to be run in a daemon thread:
        threading.Thread(target=integration_sync_loop, args=(registry, pipeline), daemon=True).start()
    """
    logger.info("Integration sync loop started (interval=%ds)", interval)
    while True:
        try:
            results = sync_all(registry, pipeline)
            total_events = sum(r.get("events_pulled", 0) for r in results)
            errors = sum(1 for r in results if r.get("status") == "error")
            logger.info(
                "Integration sync completed: %d integrations, %d events pulled, %d errors",
                len(results), total_events, errors,
            )
        except Exception as exc:
            logger.error("Integration sync loop error: %s", exc)
        time.sleep(interval)
