from __future__ import annotations

from ursus.infrastructure.persistence.base import Base
from ursus.infrastructure.persistence.schemas import (
    INCIDENT_SCHEMA,
    MESSAGING_SCHEMA,
    OBSERVED_ENTITY_SCHEMA,
    OPERATOR_SCHEMA,
)


def test_base_uses_naming_convention() -> None:
    assert "pk" in Base.metadata.naming_convention
    assert Base.metadata.naming_convention["pk"] == "pk_%(table_name)s"


def test_postgres_schema_constants() -> None:
    assert MESSAGING_SCHEMA == "messaging"
    assert OPERATOR_SCHEMA == "operator"
    assert OBSERVED_ENTITY_SCHEMA == "observed_entity"
    assert INCIDENT_SCHEMA == "incident"
