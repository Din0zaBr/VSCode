from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from server.src.auth import get_allowed_agents, verify_token

router = APIRouter()


@router.get("/stats")
async def stats(
    request: Request,
    interval: str = Query("1h"),
    from_ts: str = Query("", alias="from"),
    to_ts: str = Query("", alias="to"),
    agent_id: str = Query(""),
    service: str = Query(""),
    user: dict = Depends(verify_token),
):
    db = request.app.state.db_service
    allowed = get_allowed_agents(user, db)
    return db.get_stats(
        interval=interval, from_ts=from_ts, to_ts=to_ts,
        agent_id=agent_id, service=service,
        allowed_agents=allowed,
    )
