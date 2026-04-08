"""URSUS SIEM - API key management endpoints (admin only)."""
from __future__ import annotations

import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from server.src.auth import require_admin

router = APIRouter(prefix="/admin/api-keys", tags=["api-keys"])

_ALPHABET = string.ascii_letters + string.digits


def _generate_key(prefix: str = "ursus") -> str:
    token = "".join(secrets.choice(_ALPHABET) for _ in range(40))
    return f"{prefix}-{token}"


class CreateKeyBody(BaseModel):
    name: str


class ToggleKeyBody(BaseModel):
    enabled: bool


@router.get("")
async def list_keys(request: Request, _user: dict = Depends(require_admin)):
    keys = request.app.state.db_service.list_api_keys()
    # Mask the key value: show only prefix + last 4 chars
    for k in keys:
        v = k.get("key_value", "")
        k["key_preview"] = v[:10] + "..." + v[-4:] if len(v) > 14 else v
        # Return full value only on creation; here we omit it for security
        del k["key_value"]
    return keys


@router.post("")
async def create_key(body: CreateKeyBody, request: Request, user: dict = Depends(require_admin)):
    if not body.name.strip():
        raise HTTPException(400, "Name is required")
    key_value = _generate_key()
    row = request.app.state.db_service.create_api_key(
        name=body.name.strip(),
        key_value=key_value,
        created_by=user.get("username", "admin"),
    )
    # Return full key only once at creation time
    row["key_value"] = key_value
    return row


@router.delete("/{key_id}")
async def delete_key(key_id: int, request: Request, _user: dict = Depends(require_admin)):
    ok = request.app.state.db_service.delete_api_key(key_id)
    if not ok:
        raise HTTPException(404, "Key not found")
    return {"ok": True}


@router.patch("/{key_id}")
async def toggle_key(key_id: int, body: ToggleKeyBody, request: Request, _user: dict = Depends(require_admin)):
    ok = request.app.state.db_service.toggle_api_key(key_id, body.enabled)
    if not ok:
        raise HTTPException(404, "Key not found")
    return {"ok": True}
