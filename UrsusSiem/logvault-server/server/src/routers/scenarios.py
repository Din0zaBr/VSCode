"""URSUS SIEM - Incident Scenarios REST API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from server.src.auth import require_admin, verify_token
from server.src.services import scenarios as svc

router = APIRouter(prefix="/scenarios", tags=["scenarios"])

CRITICALITY_VALUES = ("Критический", "Высокий", "Средний", "Низкий")


class ScenarioCreate(BaseModel):
    name: str
    customer: str = ""
    criticality: str = "Высокий"
    description: str = ""
    detection_method: str = ""
    root_cause: str = ""
    recommendations: str = ""
    notes: str = ""
    custom_fields: dict = {}
    sigma_rule_ids: list[str] = []


class ScenarioUpdate(BaseModel):
    name: str | None = None
    customer: str | None = None
    criticality: str | None = None
    description: str | None = None
    detection_method: str | None = None
    root_cause: str | None = None
    recommendations: str | None = None
    notes: str | None = None
    custom_fields: dict | None = None
    sigma_rule_ids: list[str] | None = None


@router.get("")
async def list_scenarios(
    criticality: str = "",
    search: str = "",
    user: dict = Depends(verify_token),
):
    return svc.list_scenarios(criticality=criticality, search=search)


@router.get("/{scenario_id}")
async def get_scenario(scenario_id: str, user: dict = Depends(verify_token)):
    scenario = svc.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(404, f"Scenario '{scenario_id}' not found")
    return scenario


@router.post("")
async def create_scenario(body: ScenarioCreate, user: dict = Depends(verify_token)):
    if body.criticality not in CRITICALITY_VALUES:
        raise HTTPException(400, f"criticality must be one of: {CRITICALITY_VALUES}")
    return svc.create_scenario(body.model_dump())


@router.put("/{scenario_id}")
async def update_scenario(scenario_id: str, body: ScenarioUpdate, user: dict = Depends(verify_token)):
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if "criticality" in data and data["criticality"] not in CRITICALITY_VALUES:
        raise HTTPException(400, f"criticality must be one of: {CRITICALITY_VALUES}")
    scenario = svc.update_scenario(scenario_id, data)
    if not scenario:
        raise HTTPException(404, f"Scenario '{scenario_id}' not found")
    return scenario


@router.delete("/{scenario_id}")
async def delete_scenario(scenario_id: str, user: dict = Depends(require_admin)):
    ok = svc.delete_scenario(scenario_id)
    if not ok:
        raise HTTPException(404, f"Scenario '{scenario_id}' not found")
    return {"ok": True}
