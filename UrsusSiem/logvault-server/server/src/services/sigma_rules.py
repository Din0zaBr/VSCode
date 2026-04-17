"""URSUS SIEM - SIGMA Rules service: load, store and manage SIGMA YAML rules."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger("server.services.sigma_rules")

SIGMA_DATA_DIR = Path(__file__).parent.parent.parent / "data" / "sigma_rules"

_RULES_STORE: dict[str, dict] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_rules_from_disk() -> int:
    """Load all SIGMA YAML rule files from the data directory into memory."""
    loaded = 0
    if not SIGMA_DATA_DIR.exists():
        logger.warning("SIGMA rules directory not found: %s", SIGMA_DATA_DIR)
        return 0

    for path in SIGMA_DATA_DIR.glob("*.yaml"):
        try:
            with open(path, encoding="utf-8") as f:
                data = yaml.safe_load(f)
            if not isinstance(data, dict):
                continue

            rule_id = data.get("id") or path.stem
            if rule_id in _RULES_STORE:
                continue  # don't overwrite user-modified rules

            _RULES_STORE[rule_id] = {
                "id": rule_id,
                "title": data.get("title", path.stem),
                "description": data.get("description", ""),
                "category": data.get("category", "other"),
                "severity": data.get("severity", "medium"),
                "status": "enabled",
                "author": data.get("author", ""),
                "tags": data.get("tags", []),
                "rule_yaml": path.read_text(encoding="utf-8"),
                "created_at": _now(),
                "updated_at": _now(),
                "source_file": path.name,
            }
            loaded += 1
        except Exception as exc:
            logger.warning("Failed to load SIGMA rule %s: %s", path.name, exc)

    logger.info("Loaded %d SIGMA rules from disk", loaded)
    return loaded


def list_rules(
    category: str = "",
    severity: str = "",
    status: str = "",
    search: str = "",
) -> list[dict]:
    rules = list(_RULES_STORE.values())

    if category:
        rules = [r for r in rules if r["category"].lower() == category.lower()]
    if severity:
        rules = [r for r in rules if r["severity"].lower() == severity.lower()]
    if status:
        rules = [r for r in rules if r["status"].lower() == status.lower()]
    if search:
        q = search.lower()
        rules = [r for r in rules if q in r["title"].lower() or q in r["description"].lower()]

    return sorted(rules, key=lambda r: (r["severity"], r["title"]))


def get_rule(rule_id: str) -> dict | None:
    return _RULES_STORE.get(rule_id)


def create_rule(data: dict) -> dict:
    rule_id = data.get("id") or str(uuid.uuid4())[:8]
    rule = {
        "id": rule_id,
        "title": data.get("title", "Untitled Rule"),
        "description": data.get("description", ""),
        "category": data.get("category", "other"),
        "severity": data.get("severity", "medium"),
        "status": data.get("status", "enabled"),
        "author": data.get("author", ""),
        "tags": data.get("tags", []),
        "rule_yaml": data.get("rule_yaml", ""),
        "created_at": _now(),
        "updated_at": _now(),
        "source_file": None,
    }
    _RULES_STORE[rule_id] = rule
    return rule


def update_rule(rule_id: str, data: dict) -> dict | None:
    rule = _RULES_STORE.get(rule_id)
    if not rule:
        return None
    for key in ("title", "description", "category", "severity", "status", "author", "tags", "rule_yaml"):
        if key in data:
            rule[key] = data[key]
    rule["updated_at"] = _now()
    return rule


def toggle_rule(rule_id: str, enabled: bool) -> dict | None:
    rule = _RULES_STORE.get(rule_id)
    if not rule:
        return None
    rule["status"] = "enabled" if enabled else "disabled"
    rule["updated_at"] = _now()
    return rule


def delete_rule(rule_id: str) -> bool:
    return _RULES_STORE.pop(rule_id, None) is not None


def import_yaml(yaml_text: str) -> dict:
    """Parse and import a SIGMA YAML rule from text."""
    data = yaml.safe_load(yaml_text)
    if not isinstance(data, dict):
        raise ValueError("Invalid SIGMA YAML: not a dict")
    data["rule_yaml"] = yaml_text
    return create_rule(data)


def get_enabled_rules() -> list[dict]:
    return [r for r in _RULES_STORE.values() if r["status"] == "enabled"]
