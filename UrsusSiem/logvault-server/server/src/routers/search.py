from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from server.src.auth import get_allowed_agents, require_admin, verify_token
from server.src.services.pdql import PDQLParser, PDQLToSQL, PDQLParseError
from server.src.services.postgres import _parse_relative_ts

logger = logging.getLogger("server.search")

router = APIRouter()


@router.get("/search")
async def search(
    request: Request,
    q: str = Query("", description="Full-text query"),
    level: str = Query("", description="Filter by level (comma-separated)"),
    agent_id: str = Query("", alias="agent_id"),
    service: str = Query(""),
    host: str = Query("", description="Filter by hostname"),
    source: str = Query("", description="Filter by log source path"),
    from_ts: str = Query("", alias="from"),
    to_ts: str = Query("", alias="to"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=500),
    user: dict = Depends(verify_token),
):
    db = request.app.state.db_service
    allowed = get_allowed_agents(user, db)
    if allowed is not None:
        if agent_id and agent_id not in allowed:
            return {"total": 0, "logs": []}
        if not agent_id and allowed:
            agent_id = ",".join(allowed)

    return db.search(
        q=q, level=level, agent_id=agent_id, service=service,
        host=host, source=source,
        from_ts=from_ts, to_ts=to_ts, page=page, size=size,
        allowed_agents=allowed,
    )


@router.get("/search/pdql")
async def pdql_search(
    request: Request,
    query: str = Query("", description="PDQL query string"),
    from_ts: str = Query("", alias="from"),
    to_ts: str = Query("", alias="to"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=500),
    user: dict = Depends(verify_token),
):
    db = request.app.state.db_service
    allowed = get_allowed_agents(user, db)

    try:
        parser = PDQLParser()
        translator = PDQLToSQL()
        parsed = parser.parse(query)
        time_from = _parse_relative_ts(from_ts) if from_ts else None
        time_to = _parse_relative_ts(to_ts) if to_ts else None
        sql, params = translator.translate(
            parsed,
            allowed_agents=allowed,
            time_from=time_from,
            time_to=time_to,
            omit_default_limit=True,
        )
        return db.execute_pdql(sql, params, page, size)

    except PDQLParseError as e:
        logger.warning("PDQL parse error: %s", e)
        raise HTTPException(status_code=400, detail=f"PDQL syntax error: {e}")
    except Exception as e:
        logger.exception("PDQL execution error")
        raise HTTPException(status_code=400, detail=f"PDQL error: {e}")


@router.post("/search/reparse-meta")
async def reparse_meta(
    request: Request,
    limit: int = 5000,
    offset: int = 0,
    _admin: dict = Depends(require_admin),
):
    """Re-apply log parser enrichment to existing rows (category, event_type, IPs, …). Admin only."""
    if limit < 1 or limit > 50_000:
        raise HTTPException(status_code=400, detail="limit must be 1..50000")
    if offset < 0:
        raise HTTPException(status_code=400, detail="offset must be >= 0")
    db = request.app.state.db_service
    return db.reparse_meta_enrichment(limit=limit, offset=offset)
