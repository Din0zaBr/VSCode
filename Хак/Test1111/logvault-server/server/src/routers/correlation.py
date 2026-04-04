"""URSUS SIEM - Correlation rules & alerts REST API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from server.src.auth import require_admin, verify_token

router = APIRouter(prefix="/correlation", tags=["correlation"])


class RuleBody(BaseModel):
    id: str
    name: str
    description: str = ""
    severity: str = "MEDIUM"
    enabled: bool = True
    conditions: dict


class AlertStatusBody(BaseModel):
    status: str
    notes: str = ""


@router.get("/rules")
async def list_rules(request: Request, user: dict = Depends(verify_token)):
    return request.app.state.db_service.get_correlation_rules()


@router.post("/rules")
async def create_rule(body: RuleBody, request: Request, user: dict = Depends(require_admin)):
    return request.app.state.db_service.upsert_correlation_rule(body.model_dump())


@router.put("/rules/{rule_id}")
async def update_rule(rule_id: str, body: RuleBody, request: Request, user: dict = Depends(require_admin)):
    data = body.model_dump()
    data["id"] = rule_id
    return request.app.state.db_service.upsert_correlation_rule(data)


@router.delete("/rules/{rule_id}")
async def delete_rule(rule_id: str, request: Request, user: dict = Depends(require_admin)):
    ok = request.app.state.db_service.delete_correlation_rule(rule_id)
    if not ok:
        raise HTTPException(404, "Rule not found")
    return {"ok": True}


@router.get("/alerts")
async def list_alerts(
    request: Request,
    limit: int = 50, offset: int = 0,
    status: str = "", severity: str = "",
    user: dict = Depends(verify_token),
):
    return request.app.state.db_service.get_correlation_alerts(limit, offset, status, severity)


@router.patch("/alerts/{alert_id}")
async def update_alert_status(
    alert_id: int, body: AlertStatusBody, request: Request,
    user: dict = Depends(verify_token),
):
    ok = request.app.state.db_service.update_correlation_alert_status(alert_id, body.status, body.notes)
    if not ok:
        raise HTTPException(404, "Alert not found")
    return {"ok": True}
