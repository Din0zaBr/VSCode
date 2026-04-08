"""URSUS SIEM - Assets, Accounts & Exclusions REST API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from typing import Any

from server.src.auth import require_admin, verify_token

router = APIRouter(tags=["assets"])


# ── Assets ───────────────────────────────────────────────────────────────────

class AssetBody(BaseModel):
    hostname: str
    ip: str = ""
    os: str = ""
    department: str = ""
    owner: str = ""
    criticality: str = "MEDIUM"
    tags: list[str] = []
    notes: str = ""
    status: str = "active"


@router.get("/assets")
async def list_assets(
    request: Request,
    page: int = Query(1, ge=1), size: int = Query(50, ge=1, le=500),
    search: str = "", status: str = "", criticality: str = "",
    user: dict = Depends(verify_token),
):
    return request.app.state.db_service.list_assets(page, size, search, status, criticality)


@router.post("/assets")
async def create_asset(body: AssetBody, request: Request, user: dict = Depends(require_admin)):
    return request.app.state.db_service.create_asset(body.model_dump())


@router.get("/assets/{asset_id}")
async def get_asset(asset_id: int, request: Request, user: dict = Depends(verify_token)):
    asset = request.app.state.db_service.get_asset(asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    return asset


@router.put("/assets/{asset_id}")
async def update_asset(asset_id: int, body: AssetBody, request: Request, user: dict = Depends(require_admin)):
    ok = request.app.state.db_service.update_asset(asset_id, body.model_dump())
    if not ok:
        raise HTTPException(404, "Asset not found")
    return {"ok": True}


@router.delete("/assets/{asset_id}")
async def delete_asset(asset_id: int, request: Request, user: dict = Depends(require_admin)):
    ok = request.app.state.db_service.delete_asset(asset_id)
    if not ok:
        raise HTTPException(404, "Asset not found")
    return {"ok": True}


@router.post("/assets/discover")
async def discover_assets(request: Request, user: dict = Depends(require_admin)):
    count = request.app.state.db_service.auto_discover_assets()
    return {"ok": True, "discovered": count}


# ── Accounts ─────────────────────────────────────────────────────────────────

class AccountBody(BaseModel):
    username: str
    domain: str = ""
    display_name: str = ""
    email: str = ""
    department: str = ""
    role: str = ""
    risk_level: str = "NORMAL"
    is_service_account: bool = False
    is_privileged: bool = False
    notes: str = ""


@router.get("/accounts")
async def list_accounts(
    request: Request,
    page: int = Query(1, ge=1), size: int = Query(50, ge=1, le=500),
    search: str = "", domain: str = "", risk_level: str = "",
    user: dict = Depends(verify_token),
):
    return request.app.state.db_service.list_accounts(page, size, search, domain, risk_level)


@router.post("/accounts")
async def create_account(body: AccountBody, request: Request, user: dict = Depends(require_admin)):
    return request.app.state.db_service.create_account(body.model_dump())


@router.get("/accounts/{account_id}")
async def get_account(account_id: int, request: Request, user: dict = Depends(verify_token)):
    result = request.app.state.db_service.get_account(account_id)
    if not result:
        raise HTTPException(404, "Account not found")
    return result


@router.put("/accounts/{account_id}")
async def update_account(account_id: int, body: AccountBody, request: Request, user: dict = Depends(require_admin)):
    ok = request.app.state.db_service.update_account(account_id, body.model_dump())
    if not ok:
        raise HTTPException(404, "Account not found")
    return {"ok": True}


@router.delete("/accounts/{account_id}")
async def delete_account(account_id: int, request: Request, user: dict = Depends(require_admin)):
    ok = request.app.state.db_service.delete_account(account_id)
    if not ok:
        raise HTTPException(404, "Account not found")
    return {"ok": True}


@router.post("/accounts/discover")
async def discover_accounts(request: Request, user: dict = Depends(require_admin)):
    count = request.app.state.db_service.auto_discover_accounts()
    return {"ok": True, "discovered": count}


# ── Exclusions ───────────────────────────────────────────────────────────────

class ExclusionBody(BaseModel):
    name: str
    description: str = ""
    exclusion_type: str
    conditions: dict[str, Any]
    enabled: bool = True
    scope: str = "all"
    created_by: str = ""
    expires_at: str | None = None


@router.get("/exclusions")
async def list_exclusions(
    request: Request,
    page: int = Query(1, ge=1), size: int = Query(50, ge=1, le=500),
    type: str = Query("", alias="type"),
    enabled: bool | None = None,
    user: dict = Depends(verify_token),
):
    return request.app.state.db_service.list_exclusions(page, size, type, enabled)


@router.post("/exclusions")
async def create_exclusion(body: ExclusionBody, request: Request, user: dict = Depends(require_admin)):
    return request.app.state.db_service.create_exclusion(body.model_dump())


@router.get("/exclusions/{exclusion_id}")
async def get_exclusion(exclusion_id: int, request: Request, user: dict = Depends(verify_token)):
    result = request.app.state.db_service.get_exclusion(exclusion_id)
    if not result:
        raise HTTPException(404, "Exclusion not found")
    return result


@router.put("/exclusions/{exclusion_id}")
async def update_exclusion(exclusion_id: int, body: ExclusionBody, request: Request, user: dict = Depends(require_admin)):
    ok = request.app.state.db_service.update_exclusion(exclusion_id, body.model_dump())
    if not ok:
        raise HTTPException(404, "Exclusion not found")
    return {"ok": True}


@router.delete("/exclusions/{exclusion_id}")
async def delete_exclusion(exclusion_id: int, request: Request, user: dict = Depends(require_admin)):
    ok = request.app.state.db_service.delete_exclusion(exclusion_id)
    if not ok:
        raise HTTPException(404, "Exclusion not found")
    return {"ok": True}
