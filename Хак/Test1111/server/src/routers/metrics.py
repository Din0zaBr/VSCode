from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request

from server.src.auth import get_allowed_agents, verify_token

logger = logging.getLogger("server.metrics")

router = APIRouter()


@router.get("/metrics/latest")
async def latest_metrics(request: Request, user: dict = Depends(verify_token)):
    db = request.app.state.db_service
    allowed = get_allowed_agents(user, db)

    all_metrics = db.get_latest_metrics(allowed_agents=None)
    all_metric_agents = [m["agent_id"] for m in all_metrics]

    result = db.get_latest_metrics(allowed_agents=allowed)
    logger.info(
        "metrics/latest user=%s role=%s user_id=%s allowed_agents=%s "
        "agents_with_metrics=%s result_count=%d",
        user.get("sub"), user.get("role"), user.get("user_id"),
        allowed, all_metric_agents, len(result),
    )
    return result
