from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from server.src.auth import get_allowed_agents, verify_token

router = APIRouter()


@router.get("/agents")
async def list_agents(request: Request, user: dict = Depends(verify_token)):
    db = request.app.state.db_service
    agents = db.get_agents()
    allowed = get_allowed_agents(user, db)
    if allowed is not None:
        agents = [a for a in agents if a["agent_id"] in allowed]
    return agents


@router.get("/hosts")
async def list_hosts(request: Request, _user: dict = Depends(verify_token)):
    db = request.app.state.db_service
    return db.get_hosts()
