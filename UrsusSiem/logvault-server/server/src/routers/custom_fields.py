"""URSUS SIEM - Custom Fields REST API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from server.src.auth import require_admin, verify_token
from server.src.services import custom_fields as svc

router = APIRouter(prefix="/custom-fields", tags=["custom_fields"])


class FieldCreate(BaseModel):
    name: str = ""
    label: str
    type: str = "text"
    entity_type: str = "incident_scenario"
    options: list[str] = []
    required: bool = False
    description: str = ""
    default_value: str = ""


class FieldUpdate(BaseModel):
    label: str | None = None
    type: str | None = None
    options: list[str] | None = None
    required: bool | None = None
    description: str | None = None
    default_value: str | None = None


@router.get("")
async def list_fields(entity_type: str = "", user: dict = Depends(verify_token)):
    return svc.list_fields(entity_type=entity_type)


@router.get("/{field_id}")
async def get_field(field_id: str, user: dict = Depends(verify_token)):
    field = svc.get_field(field_id)
    if not field:
        raise HTTPException(404, f"Field '{field_id}' not found")
    return field


@router.post("")
async def create_field(body: FieldCreate, user: dict = Depends(require_admin)):
    return svc.create_field(body.model_dump())


@router.put("/{field_id}")
async def update_field(field_id: str, body: FieldUpdate, user: dict = Depends(require_admin)):
    field = svc.update_field(field_id, {k: v for k, v in body.model_dump().items() if v is not None})
    if not field:
        raise HTTPException(404, f"Field '{field_id}' not found")
    return field


@router.delete("/{field_id}")
async def delete_field(field_id: str, user: dict = Depends(require_admin)):
    ok = svc.delete_field(field_id)
    if not ok:
        raise HTTPException(404, f"Field '{field_id}' not found")
    return {"ok": True}


class InterpolateBody(BaseModel):
    text: str
    field_values: dict


@router.post("/interpolate")
async def interpolate(body: InterpolateBody, user: dict = Depends(verify_token)):
    result = svc.interpolate_template(body.text, body.field_values)
    return {"result": result}
