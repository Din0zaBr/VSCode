"""URSUS SIEM - Custom Fields service (in-memory store)."""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Literal

_STORE: dict[str, dict] = {}

FieldType = Literal["text", "textarea", "dropdown", "date", "number", "checkbox"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9_]", "_", name.lower().strip()).strip("_")


def list_fields(entity_type: str = "") -> list[dict]:
    fields = list(_STORE.values())
    if entity_type:
        fields = [f for f in fields if f.get("entity_type") == entity_type]
    return sorted(fields, key=lambda f: f["created_at"])


def get_field(field_id: str) -> dict | None:
    return _STORE.get(field_id)


def get_field_by_name(name: str, entity_type: str = "incident_scenario") -> dict | None:
    for f in _STORE.values():
        if f["name"] == name and f.get("entity_type") == entity_type:
            return f
    return None


def create_field(data: dict) -> dict:
    field_id = str(uuid.uuid4())
    name = data.get("name") or _slugify(data.get("label", "field"))
    field = {
        "id": field_id,
        "name": name,
        "label": data.get("label", name),
        "type": data.get("type", "text"),
        "entity_type": data.get("entity_type", "incident_scenario"),
        "options": data.get("options", []),
        "required": bool(data.get("required", False)),
        "description": data.get("description", ""),
        "default_value": data.get("default_value", ""),
        "created_at": _now(),
        "updated_at": _now(),
    }
    _STORE[field_id] = field
    return field


def update_field(field_id: str, data: dict) -> dict | None:
    field = _STORE.get(field_id)
    if not field:
        return None
    for key in ("label", "type", "options", "required", "description", "default_value"):
        if key in data:
            field[key] = data[key]
    field["updated_at"] = _now()
    return field


def delete_field(field_id: str) -> bool:
    return _STORE.pop(field_id, None) is not None


def interpolate_template(text: str, field_values: dict) -> str:
    """Replace {{custom_field[name]}} placeholders with actual values."""
    def replace(m: re.Match) -> str:
        key = m.group(1)
        return str(field_values.get(key, m.group(0)))
    return re.sub(r"\{\{custom_field\[([^\]]+)\]\}\}", replace, text)
