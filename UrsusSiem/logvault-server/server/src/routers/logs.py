from __future__ import annotations

import asyncio
import json
import logging

import jwt as pyjwt
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from server.src.config import settings
from server.src.routers.ingest import live_buffer, live_subscribers

logger = logging.getLogger("server.live")

router = APIRouter()


@router.websocket("/logs/live")
async def websocket_live(ws: WebSocket, token: str = Query("")):
    if not token:
        await ws.close(code=4001, reason="Missing token")
        return
    try:
        payload = pyjwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except pyjwt.InvalidTokenError:
        await ws.close(code=4001, reason="Invalid token")
        return

    allowed_agents: list[str] | None = None
    if payload.get("role") != "admin":
        db = ws.app.state.db_service
        allowed_agents = db.get_user_agents(payload.get("user_id", 0))
        if not allowed_agents:
            allowed_agents = payload.get("agents", [])

    await ws.accept()
    queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
    live_subscribers.append(queue)

    try:
        for doc in list(live_buffer)[-50:]:
            if allowed_agents is None or doc.get("agent_id") in allowed_agents:
                await ws.send_text(json.dumps(doc))

        while True:
            doc = await queue.get()
            if allowed_agents is None or doc.get("agent_id") in allowed_agents:
                await ws.send_text(json.dumps(doc))
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket error")
    finally:
        if queue in live_subscribers:
            live_subscribers.remove(queue)
