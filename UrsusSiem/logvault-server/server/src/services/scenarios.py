"""URSUS SIEM - Incident Scenarios service (in-memory store)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

_STORE: dict[str, dict] = {}

CRITICALITY_VALUES = ("Критический", "Высокий", "Средний", "Низкий")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_scenarios(
    criticality: str = "",
    search: str = "",
) -> list[dict]:
    items = list(_STORE.values())
    if criticality:
        items = [s for s in items if s["criticality"] == criticality]
    if search:
        q = search.lower()
        items = [s for s in items if q in s["name"].lower() or q in s["description"].lower()]
    return sorted(items, key=lambda s: s["created_at"], reverse=True)


def get_scenario(scenario_id: str) -> dict | None:
    return _STORE.get(scenario_id)


def create_scenario(data: dict) -> dict:
    scenario_id = str(uuid.uuid4())
    scenario = {
        "id": scenario_id,
        "name": data.get("name", "Untitled"),
        "customer": data.get("customer", ""),
        "criticality": data.get("criticality", "Высокий"),
        "description": data.get("description", ""),
        "detection_method": data.get("detection_method", ""),
        "root_cause": data.get("root_cause", ""),
        "recommendations": data.get("recommendations", ""),
        "notes": data.get("notes", ""),
        "custom_fields": data.get("custom_fields", {}),
        "sigma_rule_ids": data.get("sigma_rule_ids", []),
        "created_at": _now(),
        "updated_at": _now(),
    }
    _STORE[scenario_id] = scenario
    return scenario


def update_scenario(scenario_id: str, data: dict) -> dict | None:
    scenario = _STORE.get(scenario_id)
    if not scenario:
        return None
    for key in (
        "name", "customer", "criticality", "description",
        "detection_method", "root_cause", "recommendations",
        "notes", "custom_fields", "sigma_rule_ids",
    ):
        if key in data:
            scenario[key] = data[key]
    scenario["updated_at"] = _now()
    return scenario


def delete_scenario(scenario_id: str) -> bool:
    return _STORE.pop(scenario_id, None) is not None
