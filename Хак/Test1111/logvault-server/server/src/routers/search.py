from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from server.src.auth import get_allowed_agents, verify_token
from server.src.services.pdql import PDQLParser, PDQLToSQL, PDQLParseError

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
        sql, params = translator.translate(parsed, allowed_agents=allowed)
        # === ДОБАВЬТЕ ЭТИ СТРОКИ ===
        import logging
        logging.error(f"PDQL SQL: {sql}")
        logging.error(f"PDQL PARAMS: {params}")
        # ============================
        return db.execute_pdql(sql, params, page, size)

    except PDQLParseError as e:
        logging.error(f"PDQL parse error: {e}")
        raise HTTPException(status_code=400, detail=f"PDQL syntax error: {e}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"PDQL error: {e}")
    
