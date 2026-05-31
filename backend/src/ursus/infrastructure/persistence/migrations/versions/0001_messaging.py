"""create messaging schema with outbox and inbox

Revision ID: 0001_messaging
Revises:
Create Date: 2026-05-31

"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_messaging"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS messaging")
    op.create_table(
        "outbox",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("event_id", name="pk_outbox"),
        schema="messaging",
    )
    op.create_index(
        "ix_outbox_unpublished",
        "outbox",
        ["created_at"],
        schema="messaging",
        postgresql_where=sa.text("published_at IS NULL"),
    )
    op.create_table(
        "inbox",
        sa.Column("event_id", sa.Uuid(), nullable=False),
        sa.Column(
            "processed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("event_id", name="pk_inbox"),
        schema="messaging",
    )


def downgrade() -> None:
    op.drop_table("inbox", schema="messaging")
    op.drop_index("ix_outbox_unpublished", table_name="outbox", schema="messaging")
    op.drop_table("outbox", schema="messaging")
    op.execute("DROP SCHEMA IF EXISTS messaging")
