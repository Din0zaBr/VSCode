from __future__ import annotations

from ursus.infrastructure.persistence.models.common.inbox import InboxMessage
from ursus.infrastructure.persistence.models.common.outbox import OutboxMessage


def test_outbox_table_is_in_messaging_schema() -> None:
    assert OutboxMessage.__tablename__ == "outbox"
    assert OutboxMessage.__table__.schema == "messaging"


def test_outbox_has_envelope_columns() -> None:
    columns = set(OutboxMessage.__table__.columns.keys())
    assert {
        "event_id",
        "event_type",
        "schema_version",
        "occurred_at",
        "payload",
        "created_at",
        "published_at",
    } <= columns


def test_inbox_table_is_in_messaging_schema() -> None:
    assert InboxMessage.__tablename__ == "inbox"
    assert InboxMessage.__table__.schema == "messaging"
    assert "event_id" in InboxMessage.__table__.columns
    assert InboxMessage.__table__.columns["event_id"].primary_key
