"""URSUS SIEM - SIGMA Rules REST API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from server.src.auth import require_admin, verify_token
from server.src.services import sigma_rules as svc

router = APIRouter(prefix="/sigma-rules", tags=["sigma_rules"])


class RuleCreate(BaseModel):
    title: str
    description: str = ""
    category: str = "other"
    severity: str = "medium"
    status: str = "enabled"
    author: str = ""
    tags: list[str] = []
    rule_yaml: str = ""


class RuleUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    category: str | None = None
    severity: str | None = None
    status: str | None = None
    author: str | None = None
    tags: list[str] | None = None
    rule_yaml: str | None = None


class ImportBody(BaseModel):
    rule_yaml: str


class ToggleBody(BaseModel):
    enabled: bool


@router.get("")
async def list_rules(
    category: str = "",
    severity: str = "",
    status: str = "",
    search: str = "",
    user: dict = Depends(verify_token),
):
    return svc.list_rules(category=category, severity=severity, status=status, search=search)


@router.get("/stats")
async def rules_stats(user: dict = Depends(verify_token)):
    all_rules = svc.list_rules()
    return {
        "total": len(all_rules),
        "enabled": sum(1 for r in all_rules if r["status"] == "enabled"),
        "disabled": sum(1 for r in all_rules if r["status"] == "disabled"),
        "by_severity": {
            sev: sum(1 for r in all_rules if r["severity"] == sev)
            for sev in ("critical", "high", "medium", "low")
        },
        "by_category": {
            r["category"]: sum(1 for x in all_rules if x["category"] == r["category"])
            for r in all_rules
        },
    }


@router.get("/{rule_id}")
async def get_rule(rule_id: str, user: dict = Depends(verify_token)):
    rule = svc.get_rule(rule_id)
    if not rule:
        raise HTTPException(404, f"Rule '{rule_id}' not found")
    return rule


@router.post("")
async def create_rule(body: RuleCreate, user: dict = Depends(require_admin)):
    return svc.create_rule(body.model_dump())


@router.put("/{rule_id}")
async def update_rule(rule_id: str, body: RuleUpdate, user: dict = Depends(require_admin)):
    rule = svc.update_rule(rule_id, {k: v for k, v in body.model_dump().items() if v is not None})
    if not rule:
        raise HTTPException(404, f"Rule '{rule_id}' not found")
    return rule


@router.post("/{rule_id}/toggle")
async def toggle_rule(rule_id: str, body: ToggleBody, user: dict = Depends(require_admin)):
    rule = svc.toggle_rule(rule_id, body.enabled)
    if not rule:
        raise HTTPException(404, f"Rule '{rule_id}' not found")
    return rule


@router.delete("/{rule_id}")
async def delete_rule(rule_id: str, user: dict = Depends(require_admin)):
    ok = svc.delete_rule(rule_id)
    if not ok:
        raise HTTPException(404, f"Rule '{rule_id}' not found")
    return {"ok": True}


@router.post("/import")
async def import_rule(body: ImportBody, user: dict = Depends(require_admin)):
    try:
        rule = svc.import_yaml(body.rule_yaml)
    except Exception as exc:
        raise HTTPException(400, f"Invalid SIGMA YAML: {exc}")
    return rule
