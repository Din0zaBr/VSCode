from __future__ import annotations

import logging
from typing import Any

from server.src.models import LogEvent
from server.src.services.postgres import PGService

logger = logging.getLogger("server.pipeline")


class IngestPipeline:
    """validate -> enrich -> index."""

    def __init__(self, db: PGService) -> None:
        self.db = db

    @staticmethod
    def validate(event: LogEvent) -> bool:
        if not event.message:
            return False
        if not event.timestamp:
            return False
        return True

    @staticmethod
    def enrich(event: LogEvent, agent_id: str) -> dict[str, Any]:
        doc = event.model_dump()
        if not doc.get("agent_id"):
            doc["agent_id"] = agent_id
        doc["level"] = (doc.get("level") or "INFO").upper()
        return doc

    def process(self, events: list[LogEvent], agent_id: str) -> tuple[int, int]:
        docs: list[dict[str, Any]] = []
        for ev in events:
            if not self.validate(ev):
                continue
            docs.append(self.enrich(ev, agent_id))
        if not docs:
            return 0, 0
        return self.db.bulk_index(docs)
