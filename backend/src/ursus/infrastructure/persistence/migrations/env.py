from __future__ import annotations

import os

from alembic import context
from sqlalchemy import engine_from_config, pool

from ursus.infrastructure.persistence.base import Base

# Importing the models registers their tables on Base.metadata.
from ursus.infrastructure.persistence.models.common import inbox, outbox  # noqa: F401

config = context.config
# Only fall back to env/default when the caller (e.g. tests) has not already injected a URL
# via config.set_main_option — otherwise we would clobber the testcontainer DSN.
if not config.get_main_option("sqlalchemy.url"):
    config.set_main_option(
        "sqlalchemy.url",
        os.environ.get(
            "URSUS_POSTGRES_DSN",
            "postgresql+psycopg://ursus:ursus@localhost:5432/ursus",
        ),
    )

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        include_schemas=True,
        literal_binds=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_schemas=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
