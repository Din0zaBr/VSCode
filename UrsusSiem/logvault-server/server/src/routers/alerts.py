from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from server.src.auth import require_admin, verify_token
from server.src.services.alerting import add_rule, get_rules, remove_rule, set_rules

router = APIRouter(prefix="/alerts")


@router.get("/")
async def list_rules(_user: dict = Depends(verify_token)):
    return get_rules()


@router.post("/")
async def create_rule(rule: dict[str, Any], _user: dict = Depends(require_admin)):
    if not rule.get("id"):
        rule["id"] = uuid.uuid4().hex[:12]
    add_rule(rule)
    return {"ok": True, "id": rule["id"]}


@router.delete("/{rule_id}")
async def delete_rule(rule_id: str, _user: dict = Depends(require_admin)):
    if not remove_rule(rule_id):
        raise HTTPException(status_code=404, detail="Rule not found")
    return {"ok": True}


@router.put("/")
async def replace_rules(rules: list[dict[str, Any]], _user: dict = Depends(require_admin)):
    set_rules(rules)
    return {"ok": True, "count": len(rules)}
