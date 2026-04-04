from __future__ import annotations

import asyncio
import logging
from collections import deque
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from server.src.auth import verify_api_key
from server.src.config import settings
from server.src.models import IngestRequest, IngestResponse

logger = logging.getLogger("server.ingest")

router = APIRouter()

live_buffer: deque[dict[str, Any]] = deque(maxlen=settings.LIVE_BUFFER_SIZE)
live_subscribers: list[asyncio.Queue] = []


@router.post("/ingest", response_model=IngestResponse)
async def ingest(body: IngestRequest, request: Request, _key: str = Depends(verify_api_key)):
    if len(body.logs) > settings.MAX_BATCH_SIZE:
        raise HTTPException(status_code=413, detail=f"Batch too large (max {settings.MAX_BATCH_SIZE})")

    pipeline = request.app.state.pipeline
    indexed, errors = pipeline.process(body.logs, body.agent_id)

    for log in body.logs:
        doc = log.model_dump()
        doc["agent_id"] = body.agent_id
        live_buffer.append(doc)
        for q in list(live_subscribers):
            try:
                q.put_nowait(doc)
            except asyncio.QueueFull:
                pass

    return IngestResponse(ok=True, indexed=indexed, errors=errors)
