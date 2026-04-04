from __future__ import annotations

import logging
import time

import requests

from agent.src.models import IngestBatch, LogEvent
from agent.src.transport.base import Transport

logger = logging.getLogger("agent.transport.http")


class HttpTransport(Transport):
    """Sends log batches over HTTP POST with retry and exponential backoff."""

    def __init__(
        self,
        server_url: str,
        agent_id: str,
        api_key: str,
        retry_base: float = 1.0,
        retry_max: float = 60.0,
        timeout: float = 10.0,
    ) -> None:
        self.url = server_url.rstrip("/") + "/ingest"
        self.agent_id = agent_id
        self.api_key = api_key
        self.retry_base = retry_base
        self.retry_max = retry_max
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers["X-Api-Key"] = self.api_key

    def send(self, batch: list[LogEvent]) -> bool:
        if not batch:
            return True
        payload = IngestBatch(
            agent_id=self.agent_id,
            api_key=self.api_key,
            logs=batch,
        )
        delay = self.retry_base
        for attempt in range(5):
            try:
                resp = self._session.post(
                    self.url,
                    data=payload.model_dump_json(),
                    headers={"Content-Type": "application/json"},
                    timeout=self.timeout,
                )
                if resp.status_code < 400:
                    return True
                logger.warning("Server returned %d: %s", resp.status_code, resp.text[:200])
            except requests.RequestException as exc:
                logger.warning("Transport error (attempt %d): %s", attempt + 1, exc)
            time.sleep(delay)
            delay = min(delay * 2, self.retry_max)
        return False

    def close(self) -> None:
        self._session.close()
