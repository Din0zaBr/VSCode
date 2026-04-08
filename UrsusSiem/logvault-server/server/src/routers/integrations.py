"""URSUS SIEM - Integrations REST API (AD + vendor integrations)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from server.src.auth import require_admin, verify_token

router = APIRouter(prefix="/integrations", tags=["integrations"])


# ── Active Directory ─────────────────────────────────────────────────────────

class ADConfigBody(BaseModel):
    server: str
    domain: str
    username: str
    password: str
    base_dn: str
    use_ssl: bool = True
    port: int = 636


@router.get("/ad/status")
async def ad_status(request: Request, user: dict = Depends(verify_token)):
    return request.app.state.ad_connector.get_status()


@router.post("/ad/configure")
async def ad_configure(body: ADConfigBody, request: Request, user: dict = Depends(require_admin)):
    request.app.state.ad_connector.configure(**body.model_dump())
    return {"ok": True}


@router.post("/ad/test")
async def ad_test(request: Request, user: dict = Depends(require_admin)):
    ok = request.app.state.ad_connector.connect()
    return {"ok": ok, "message": "Connected" if ok else "Connection failed (stub)"}


@router.post("/ad/sync")
async def ad_sync(request: Request, user: dict = Depends(require_admin)):
    users = request.app.state.ad_connector.sync_users()
    computers = request.app.state.ad_connector.sync_computers()
    return {"ok": True, "users_synced": len(users), "computers_synced": len(computers)}


# ── Generic integrations ─────────────────────────────────────────────────────

@router.get("")
async def list_integrations(request: Request, user: dict = Depends(verify_token)):
    return request.app.state.integration_registry.list_all()


@router.get("/{name}/status")
async def integration_status(name: str, request: Request, user: dict = Depends(verify_token)):
    integration = request.app.state.integration_registry.get(name)
    if not integration:
        raise HTTPException(404, f"Integration '{name}' not found")
    return integration.get_status()


class IntegrationConfigBody(BaseModel):
    config: dict


@router.post("/{name}/configure")
async def configure_integration(
    name: str, body: IntegrationConfigBody, request: Request,
    user: dict = Depends(require_admin),
):
    integration = request.app.state.integration_registry.get(name)
    if not integration:
        raise HTTPException(404, f"Integration '{name}' not found")
    integration.configure(**body.config)
    return {"ok": True}


@router.post("/{name}/test")
async def test_integration(name: str, request: Request, user: dict = Depends(require_admin)):
    integration = request.app.state.integration_registry.get(name)
    if not integration:
        raise HTTPException(404, f"Integration '{name}' not found")
    result = integration.health_check()
    return {"ok": True, "result": result}


@router.post("/{name}/sync")
async def sync_integration(name: str, request: Request, user: dict = Depends(require_admin)):
    integration = request.app.state.integration_registry.get(name)
    if not integration:
        raise HTTPException(404, f"Integration '{name}' not found")
    events = integration.pull_events()
    return {"ok": True, "events_pulled": len(events)}
